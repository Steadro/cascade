import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSubscriptionStatus } from "../utils/subscription.server";
import { getDashboardData } from "../utils/pairing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const subscription = await getSubscriptionStatus(admin);
  const dashboard = await getDashboardData(shop);

  const recentJobsWithParsedTypes = dashboard.recentJobs.map((job) => {
    let parsedTypes: string[];
    try {
      const parsed = JSON.parse(job.resourceTypes);
      parsedTypes = Array.isArray(parsed) ? parsed : [];
    } catch {
      parsedTypes = [];
    }
    return { ...job, resourceTypesList: parsedTypes };
  });

  return {
    shop,
    tier: subscription.tier,
    isActive: subscription.isActive,
    ...dashboard,
    recentJobs: recentJobsWithParsedTypes,
  };
};

type BadgeTone =
  | "info"
  | "success"
  | "critical"
  | "warning"
  | "auto"
  | "neutral"
  | "caution";

const STATUS_TONES: Record<string, BadgeTone> = {
  completed: "success",
  failed: "critical",
  running: "info",
  pending: "neutral",
  cancelled: "warning",
};

export default function Index() {
  const { isActive, pairings, recentJobs, hasPairings } =
    useLoaderData<typeof loader>();

  const primaryPairings = pairings.filter((p) => p.role === "primary");
  const pairedWith = pairings.find((p) => p.role === "paired");
  const pendingRequests = pairings.filter(
    (p) => p.role === "paired" && p.status === "pending",
  );

  return (
    <s-page heading="Cascade">
      {pendingRequests.length > 0 && (
        <s-banner tone="warning">
          <s-stack direction="inline" gap="base">
            <s-text>
              You have {pendingRequests.length} pending pairing{" "}
              {pendingRequests.length === 1 ? "request" : "requests"} from{" "}
              {pendingRequests.map((p) => p.primaryShop).join(", ")}.
            </s-text>
            <s-button href="/app/stores">Review requests</s-button>
          </s-stack>
        </s-banner>
      )}

      {hasPairings && primaryPairings.length > 0 && (
        <s-banner>
          <s-text>
            This is your primary store with {primaryPairings.length} paired
            environment(s).
          </s-text>
        </s-banner>
      )}

      {hasPairings && pairedWith && primaryPairings.length === 0 && (
        <s-banner tone="info">
          <s-text>
            This store is paired with {pairedWith.primaryShop}. Manage pairings
            and billing from the primary store.
          </s-text>
        </s-banner>
      )}

      {!isActive && (
        <s-banner tone="warning">
          <s-text>
            You&apos;re on the Free plan. Upgrade to start syncing content
            between stores.
          </s-text>
        </s-banner>
      )}

      {!hasPairings && (
        <s-section heading="Get started">
          <s-stack direction="block" gap="base">
            <s-text>
              No stores paired yet. Pair a dev or staging store to start syncing
              content.
            </s-text>
            <s-button href="/app/stores">Pair a store</s-button>
          </s-stack>
        </s-section>
      )}

      {hasPairings && (
        <>
          <s-section heading="Paired Stores">
            <s-stack direction="block" gap="base">
              {pairings.map((pairing) => (
                <s-box
                  key={pairing.id}
                  padding="base"
                  background="base"
                  borderRadius="base"
                  borderWidth="base"
                  borderColor="base"
                >
                  <s-stack direction="block" gap="small-200">
                    <s-text type="strong">
                      {pairing.role === "primary"
                        ? pairing.pairedShop
                        : pairing.primaryShop}
                    </s-text>
                    <s-stack direction="inline" gap="small-200">
                      {pairing.label && <s-badge>{pairing.label}</s-badge>}
                      <s-badge
                        tone={
                          pairing.status === "active"
                            ? "success"
                            : pairing.status === "pending"
                              ? "warning"
                              : "critical"
                        }
                      >
                        {pairing.status === "pending"
                          ? pairing.role === "primary"
                            ? "Awaiting approval"
                            : "Pending your approval"
                          : pairing.status}
                      </s-badge>
                    </s-stack>
                    <s-text color="subdued">
                      {pairing.lastSyncedAt
                        ? `Last synced: ${new Date(pairing.lastSyncedAt).toLocaleDateString()}`
                        : "Never synced"}
                    </s-text>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Recent Activity">
            {recentJobs.length === 0 ? (
              <s-text color="subdued">No sync jobs yet.</s-text>
            ) : (
              <s-stack direction="block" gap="base">
                {recentJobs.map((job) => (
                  <s-box
                    key={job.id}
                    padding="base"
                    background="base"
                    borderRadius="base"
                    borderWidth="base"
                    borderColor="base"
                  >
                    <s-stack direction="inline" gap="base">
                      <s-stack direction="block" gap="small-200">
                        <s-text>
                          {job.sourceShop} → {job.targetShop}
                        </s-text>
                        <s-text color="subdued">
                            {job.resourceTypesList.join(", ")}
                        </s-text>
                      </s-stack>
                      <s-stack direction="block" gap="small-200">
                        <s-badge tone={STATUS_TONES[job.status] ?? "info"}>
                          {job.status}
                        </s-badge>
                        <s-text color="subdued">
                          {new Date(job.createdAt).toLocaleDateString()}
                        </s-text>
                      </s-stack>
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            )}
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
