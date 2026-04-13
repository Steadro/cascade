import db from "../db.server";
import { createStoreClient } from "../utils/admin-client.server";
import { assertShopIsPaired } from "./guards.server";
import { createRateLimitedClient } from "./rate-limiter.server";
import { IdRemapper } from "./id-remapper.server";
import { rewriteCdnUrls, type CdnRewriteCache } from "./cdn-rewriter.server";
import { readResources } from "./reader.server";
import { matchResources } from "./matcher.server";
import { diffResourceType } from "./diff.server";
import {
  buildMetafieldDefinitionMutation,
  buildProductMutation,
  buildCollectionMutation,
  buildPageMutation,
  buildBlogMutation,
  buildMenuMutation,
  buildUrlRedirectMutation,
  buildPublishMutation,
  type MutationResult,
} from "./mutations.server";
import {
  SYNC_ORDER,
  type ResourceType,
  type DiffItem,
  type StoreClient,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncError {
  readonly resourceType: string;
  readonly handle: string;
  readonly action: string;
  readonly error: string;
}

// ---------------------------------------------------------------------------
// Publication query
// ---------------------------------------------------------------------------

const PUBLICATIONS_QUERY = `#graphql
  query Publications {
    publications(first: 20) {
      nodes {
        id
        name
        supportsFuturePublishing
      }
    }
  }
`;

async function findOnlineStorePublicationId(
  client: StoreClient,
): Promise<string | null> {
  const response = await client.request(PUBLICATIONS_QUERY);
  const publications = (
    response.data?.publications as {
      nodes: Array<{ id: string; name: string }>;
    }
  )?.nodes;

  if (!publications) return null;

  const onlineStore = publications.find(
    (p) => p.name === "Online Store",
  );

  return onlineStore?.id ?? null;
}

// ---------------------------------------------------------------------------
// Mutation dispatch
// ---------------------------------------------------------------------------

function buildMutation(
  resourceType: ResourceType,
  item: DiffItem,
  remapper: IdRemapper,
  bodyOverride?: string,
): MutationResult | null {
  switch (resourceType) {
    case "metafieldDefinitions":
      return buildMetafieldDefinitionMutation(item);
    case "products":
      return buildProductMutation(item, remapper);
    case "collections":
      return buildCollectionMutation(item);
    case "pages":
      return buildPageMutation(item, bodyOverride);
    case "blogs":
      return buildBlogMutation(item, remapper, bodyOverride);
    case "menus":
      return buildMenuMutation(item, remapper);
    case "urlRedirects":
      return buildUrlRedirectMutation(item);
  }
}

function needsCdnRewrite(
  resourceType: ResourceType,
  data: Record<string, unknown>,
): boolean {
  if (resourceType === "pages") return typeof data.body === "string";
  if (resourceType === "blogs") return "_blogHandle" in data && typeof data.body === "string";
  return false;
}

function extractCreatedId(
  resourceType: ResourceType,
  responseData: Record<string, unknown>,
): string | null {
  const mutationKey = getMutationKey(resourceType);
  const payload = responseData[mutationKey] as Record<string, unknown> | undefined;
  if (!payload) return null;

  const resourceKey = getResourceKey(resourceType);
  const resource = payload[resourceKey] as { id: string } | undefined;
  return resource?.id ?? null;
}

function getMutationKey(resourceType: ResourceType): string {
  switch (resourceType) {
    case "metafieldDefinitions":
      return "metafieldDefinitionCreate";
    case "products":
      return "productSet";
    case "collections":
      return "collectionCreate";
    case "pages":
      return "pageCreate";
    case "blogs":
      return "blogCreate";
    case "menus":
      return "menuCreate";
    case "urlRedirects":
      return "urlRedirectCreate";
  }
}

function getResourceKey(resourceType: ResourceType): string {
  switch (resourceType) {
    case "metafieldDefinitions":
      return "createdDefinition";
    case "products":
      return "product";
    case "collections":
      return "collection";
    case "pages":
      return "page";
    case "blogs":
      return "blog";
    case "menus":
      return "menu";
    case "urlRedirects":
      return "urlRedirect";
  }
}

function extractUserErrors(
  responseData: Record<string, unknown>,
): Array<{ message: string }> {
  for (const value of Object.values(responseData)) {
    if (typeof value === "object" && value !== null && "userErrors" in value) {
      const errors = (value as { userErrors: Array<{ message: string }> })
        .userErrors;
      if (errors.length > 0) return errors;
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Progress updates
// ---------------------------------------------------------------------------

async function updateJobProgress(
  jobId: string,
  processedItems: number,
  totalItems: number,
): Promise<void> {
  const progress = totalItems > 0
    ? Math.round((processedItems / totalItems) * 100)
    : 0;

  await db.syncJob.update({
    where: { id: jobId },
    data: { processedItems, progress },
  });
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

const BULK_WARNING_THRESHOLD = 200;

export async function executeSync(syncJobId: string): Promise<void> {
  // 1. Load job, verify pending, set running
  const job = await db.syncJob.findUnique({
    where: { id: syncJobId },
  });

  if (!job) throw new Error(`SyncJob ${syncJobId} not found`);
  if (job.status !== "pending") {
    throw new Error(`SyncJob ${syncJobId} is ${job.status}, expected pending`);
  }

  await db.syncJob.update({
    where: { id: syncJobId },
    data: { status: "running", startedAt: new Date() },
  });

  const errors: SyncError[] = [];

  try {
    // 2. Validate pairing
    const pairing = await assertShopIsPaired(job.sourceShop, job.pairingId);

    // 3. Create clients
    const sourceClient = await createStoreClient(job.sourceShop);
    const targetClientRaw = await createStoreClient(job.targetShop);
    const targetClient = createRateLimitedClient(targetClientRaw);

    // 4. Load ID remapper
    const remapper = new IdRemapper(pairing.pairingId);
    await remapper.loadMappings();

    // 5. Query publications
    const publicationId = await findOnlineStorePublicationId(targetClient);

    // 6. Re-run read-match-diff
    const resourceTypes = JSON.parse(job.resourceTypes) as ResourceType[];
    const orderedTypes = SYNC_ORDER.filter((t) => resourceTypes.includes(t));

    const [sourceData, targetData] = await Promise.all([
      readResources(sourceClient, orderedTypes),
      readResources(targetClient, orderedTypes),
    ]);

    const diffResults = orderedTypes.map((type) => {
      const sourceRecords = sourceData.get(type) ?? [];
      const targetRecords = targetData.get(type) ?? [];
      const matchResult = matchResources(sourceRecords, targetRecords);
      return { type, result: diffResourceType(type, matchResult) };
    });

    // 7. Calculate totals
    const actionableItems = diffResults.flatMap(({ type, result }) =>
      result.items
        .filter((item) => item.action !== "skip")
        .map((item) => ({ type, item })),
    );

    const totalItems = actionableItems.length;

    if (totalItems > BULK_WARNING_THRESHOLD) {
      console.warn(
        `SyncJob ${syncJobId}: ${totalItems} items exceeds ${BULK_WARNING_THRESHOLD}. Consider Bulk Operations in Phase 5.`,
      );
    }

    await db.syncJob.update({
      where: { id: syncJobId },
      data: { totalItems },
    });

    // 8. Execute mutations
    let processedItems = 0;
    const cdnCache: CdnRewriteCache = new Map<string, string>();

    for (const { type, item } of actionableItems) {
      try {
        // CDN rewrite if needed
        let bodyOverride: string | undefined;
        if (needsCdnRewrite(type, item.sourceRecord.data)) {
          const body = item.sourceRecord.data.body as string;
          const rewriteResult = await rewriteCdnUrls(body, targetClient, cdnCache);
          bodyOverride = rewriteResult.html;
        }

        // Build mutation
        const mutation = buildMutation(type, item, remapper, bodyOverride);
        if (!mutation) {
          processedItems += 1;
          await updateJobProgress(syncJobId, processedItems, totalItems);
          continue;
        }

        // Execute
        const response = await targetClient.request(
          mutation.mutation,
          { variables: mutation.variables },
        );

        if (response.errors) {
          const msg = typeof response.errors === "string"
            ? response.errors
            : JSON.stringify(response.errors);
          errors.push({
            resourceType: type,
            handle: item.handle,
            action: item.action,
            error: msg,
          });
          processedItems += 1;
          await updateJobProgress(syncJobId, processedItems, totalItems);
          continue;
        }

        // Check userErrors
        const userErrors = extractUserErrors(response.data ?? {});
        if (userErrors.length > 0) {
          errors.push({
            resourceType: type,
            handle: item.handle,
            action: item.action,
            error: userErrors.map((e) => e.message).join("; "),
          });
          processedItems += 1;
          await updateJobProgress(syncJobId, processedItems, totalItems);
          continue;
        }

        // On success: update ResourceMap
        if (item.action === "create" && response.data) {
          const createdId = extractCreatedId(type, response.data);
          if (createdId) {
            await remapper.addMapping(
              item.sourceRecord.id,
              createdId,
              type,
              item.handle,
            );

            // Publish products and collections
            if (
              publicationId &&
              (type === "products" || type === "collections")
            ) {
              const publishMutation = buildPublishMutation(
                createdId,
                publicationId,
              );
              await targetClient.request(publishMutation.mutation, {
                variables: publishMutation.variables,
              });
            }
          }
        }

        if (item.action === "update" && item.targetRecord) {
          await remapper.addMapping(
            item.sourceRecord.id,
            item.targetRecord.id,
            type,
            item.handle,
          );
        }

        processedItems += 1;
        await updateJobProgress(syncJobId, processedItems, totalItems);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({
          resourceType: type,
          handle: item.handle,
          action: item.action,
          error: message,
        });
        processedItems += 1;
        await updateJobProgress(syncJobId, processedItems, totalItems);
      }
    }

    // 9. Flush remaining writes
    await remapper.flush();

    // 10. Set final status
    const allFailed = totalItems > 0 && errors.length === totalItems;
    await db.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: allFailed ? "failed" : "completed",
        completedAt: new Date(),
        progress: 100,
        processedItems: totalItems,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errors: JSON.stringify([...errors, { resourceType: "system", handle: "", action: "", error: message }]),
      },
    });
  }
}
