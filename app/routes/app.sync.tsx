import { useState, useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSubscriptionStatus } from "../utils/subscription.server";
import { getPairingsForShop } from "../utils/pairing.server";
import { createStoreClient, wrapAuthAdmin } from "../utils/admin-client.server";
import { generatePreview } from "../sync/index.server";
import {
  RESOURCE_TYPE_LABELS,
  SYNC_ORDER,
  type ResourceType,
  type SyncDirection,
  type SyncPreview,
} from "../sync/types";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const subscription = await getSubscriptionStatus(admin);
  const pairings = await getPairingsForShop(shop);

  return {
    shop,
    pairings,
    tier: subscription.tier,
    canSync: subscription.tier !== "free",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  if (actionType === "preview") {
    const pairingId = formData.get("pairingId") as string;
    const rawDirection = formData.get("direction") as string;
    const direction: SyncDirection =
      rawDirection === "push" || rawDirection === "pull" ? rawDirection : "push";
    const typesRaw = (formData.get("resourceTypes") as string) ?? "";
    const resourceTypes = typesRaw
      .split(",")
      .slice(0, 20)
      .filter((t): t is ResourceType => t in RESOURCE_TYPE_LABELS);

    if (!pairingId) {
      return { ok: false, error: "Select a target store" };
    }

    if (resourceTypes.length === 0) {
      return { ok: false, error: "Select at least one resource type" };
    }

    const pairing = await db.storePairing.findFirst({
      where: {
        id: pairingId,
        status: "active",
        OR: [{ primaryShop: shop }, { pairedShop: shop }],
      },
    });

    if (!pairing) {
      return { ok: false, error: "Invalid or inactive store pairing" };
    }

    const pairedShop =
      pairing.primaryShop === shop ? pairing.pairedShop : pairing.primaryShop;

    const sourceShop = direction === "push" ? shop : pairedShop;
    const targetShop = direction === "push" ? pairedShop : shop;

    try {
      const sourceClient =
        sourceShop === shop
          ? wrapAuthAdmin(admin)
          : await createStoreClient(sourceShop);
      const targetClient =
        targetShop === shop
          ? wrapAuthAdmin(admin)
          : await createStoreClient(targetShop);

      const preview = await generatePreview(
        sourceClient,
        targetClient,
        resourceTypes,
        sourceShop,
        targetShop,
        direction,
      );

      return { ok: true, preview };
    } catch (error) {
      console.error("Preview generation failed:", error);
      return {
        ok: false,
        error:
          "Failed to generate preview. Ensure both stores have Cascade installed.",
      };
    }
  }

  return { ok: false, error: "Unknown action" };
};

const ACTION_TONES = {
  create: "info",
  update: "warning",
} as const;

export default function SyncPage() {
  const { pairings, tier } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [step, setStep] = useState<"configure" | "preview">("configure");
  const [selectedPairing, setSelectedPairing] = useState("");
  const [direction, setDirection] = useState<SyncDirection>("push");
  const [selectedTypes, setSelectedTypes] = useState<Set<ResourceType>>(
    new Set(SYNC_ORDER),
  );

  const isLoading = fetcher.state !== "idle";
  const preview = fetcher.data?.ok
    ? (fetcher.data as { ok: true; preview: SyncPreview }).preview
    : null;

  useEffect(() => {
    if (fetcher.data?.ok && preview && fetcher.state === "idle") {
      setStep("preview");
    }
  }, [fetcher.data, fetcher.state, preview]);

  useEffect(() => {
    if (fetcher.data && !fetcher.data.ok && fetcher.state === "idle") {
      shopify.toast.show(
        (fetcher.data as { ok: false; error: string }).error,
        { isError: true },
      );
    }
  }, [fetcher.data, fetcher.state, shopify]);

  function toggleType(type: ResourceType) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selectedTypes.size === SYNC_ORDER.length) {
      setSelectedTypes(new Set());
    } else {
      setSelectedTypes(new Set(SYNC_ORDER));
    }
  }

  function submitPreview() {
    fetcher.submit(
      {
        _action: "preview",
        pairingId: selectedPairing,
        direction,
        resourceTypes: Array.from(selectedTypes).join(","),
      },
      { method: "POST" },
    );
  }

  if (step === "preview" && preview) {
    return (
      <s-page heading="Sync Preview">
        <s-button slot="back-action" onClick={() => setStep("configure")}>
          Back
        </s-button>

        <s-banner>
          <s-text>
            {preview.sourceShop} → {preview.targetShop}:{" "}
            {preview.totalCreate} to create, {preview.totalUpdate} to update,{" "}
            {preview.totalSkip} unchanged
          </s-text>
        </s-banner>

        {preview.results
          .filter((r) => r.createCount > 0 || r.updateCount > 0)
          .map((result) => (
            <s-section key={result.resourceType} heading={result.label}>
              <s-stack direction="inline" gap="small-200">
                {result.createCount > 0 && (
                  <s-badge tone="info">{result.createCount} create</s-badge>
                )}
                {result.updateCount > 0 && (
                  <s-badge tone="warning">{result.updateCount} update</s-badge>
                )}
                {result.skipCount > 0 && (
                  <s-badge>{result.skipCount} skip</s-badge>
                )}
              </s-stack>

              <s-stack direction="block" gap="small-200">
                {result.items
                  .filter((item) => item.action !== "skip")
                  .map((item) => (
                    <s-stack
                      key={item.handle}
                      direction="inline"
                      gap="small-200"
                    >
                      <s-badge
                        tone={
                          item.action === "create"
                            ? ACTION_TONES.create
                            : ACTION_TONES.update
                        }
                      >
                        {item.action}
                      </s-badge>
                      <s-text>{item.title}</s-text>
                      <s-text color="subdued">{item.handle}</s-text>
                    </s-stack>
                  ))}
              </s-stack>
            </s-section>
          ))}

        {preview.totalCreate === 0 && preview.totalUpdate === 0 && (
          <s-section>
            <s-text color="subdued">
              Everything is in sync — no changes needed.
            </s-text>
          </s-section>
        )}

        <s-section>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" disabled>
              Start Sync
            </s-button>
            <s-button onClick={() => setStep("configure")}>Back</s-button>
          </s-stack>
          <s-text color="subdued">
            Sync execution will be available in a future update.
          </s-text>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Sync">
      {tier === "free" && (
        <s-banner tone="warning">
          <s-text>
            Free plan: you can preview changes but cannot execute syncs.
            Upgrade to start syncing.
          </s-text>
        </s-banner>
      )}

      {pairings.length === 0 ? (
        <s-section>
          <s-text>
            No paired stores yet. Pair a store first to start syncing.
          </s-text>
          <s-button href="/app/stores">Go to Stores</s-button>
        </s-section>
      ) : (
        <s-section heading="Configure Sync">
          <s-stack direction="block" gap="base">
            <s-select
              label="Target store"
              name="targetStore"
              placeholder="Select a store..."
              value={selectedPairing}
              onChange={(e: Event) =>
                setSelectedPairing(
                  (e.target as HTMLSelectElement).value,
                )
              }
            >
              {pairings.map((p) => (
                <s-option key={p.id} value={p.id}>
                  {p.role === "primary" ? p.pairedShop : p.primaryShop}
                  {p.label ? ` (${p.label})` : ""}
                </s-option>
              ))}
            </s-select>

            <s-stack direction="inline" gap="base">
              <s-button
                variant={direction === "push" ? "primary" : "tertiary"}
                onClick={() => setDirection("push")}
              >
                Push (this store → target)
              </s-button>
              <s-button
                variant={direction === "pull" ? "primary" : "tertiary"}
                onClick={() => setDirection("pull")}
              >
                Pull (target → this store)
              </s-button>
            </s-stack>

            <s-section heading="Resource Types">
              <s-stack direction="block" gap="small-200">
                <s-checkbox
                  label="Select All"
                  checked={selectedTypes.size === SYNC_ORDER.length}
                  onChange={toggleAll}
                />
                {SYNC_ORDER.map((type) => (
                  <s-checkbox
                    key={type}
                    label={RESOURCE_TYPE_LABELS[type]}
                    checked={selectedTypes.has(type)}
                    onChange={() => toggleType(type)}
                  />
                ))}
              </s-stack>
            </s-section>

            <s-button
              variant="primary"
              onClick={submitPreview}
              {...(isLoading ? { loading: true } : {})}
            >
              Preview Changes
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
