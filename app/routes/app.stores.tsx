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
import {
  normalizeDomain,
  getPairingsForShop,
  validatePairingRequest,
  createPairing,
  removePairing,
} from "../utils/pairing.server";

const MAX_LABEL_LENGTH = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const subscription = await getSubscriptionStatus(admin);
  const pairings = await getPairingsForShop(shop);

  return {
    shop,
    pairings,
    tier: subscription.tier,
    pairingLimit: subscription.pairingLimit,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  if (actionType === "create") {
    const rawDomain = ((formData.get("domain") as string) ?? "").trim();
    if (!rawDomain) {
      return { ok: false, error: "Store domain is required" };
    }

    const rawLabel = ((formData.get("label") as string) ?? "").trim();
    const label = rawLabel.length > 0
      ? rawLabel.slice(0, MAX_LABEL_LENGTH)
      : "Development";

    let normalizedDomain: string;
    try {
      normalizedDomain = normalizeDomain(rawDomain);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid domain",
      };
    }

    const validation = await validatePairingRequest(
      shop,
      normalizedDomain,
      admin,
    );
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    try {
      const pairing = await createPairing(shop, normalizedDomain, label);
      return { ok: true, pairing };
    } catch (error) {
      console.error("Failed to create pairing:", error);
      return { ok: false, error: "Failed to create pairing. Please try again." };
    }
  }

  if (actionType === "remove") {
    const pairingId = formData.get("pairingId") as string;
    if (!pairingId) {
      return { ok: false, error: "Missing pairing ID" };
    }

    try {
      await removePairing(shop, pairingId);
      return { ok: true };
    } catch (error) {
      console.error("Failed to remove pairing:", error);
      return { ok: false, error: "Unable to remove pairing. Please try again." };
    }
  }

  return { ok: false, error: "Unknown action" };
};

export default function StoresPage() {
  const { shop, pairings, tier, pairingLimit } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [showForm, setShowForm] = useState(false);
  const [domain, setDomain] = useState("");
  const [label, setLabel] = useState("Development");

  const isSubmitting = fetcher.state !== "idle";
  const isPrimary = pairings.length === 0 || pairings.some((p) => p.role === "primary");
  const activePrimaryCount = pairings.filter((p) => p.role === "primary").length;
  const canAddMore = isPrimary && activePrimaryCount < pairingLimit;

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.state === "idle") {
      shopify.toast.show("Store pairing updated");
      setShowForm(false);
      setDomain("");
      setLabel("Development");
    }
  }, [fetcher.data, fetcher.state, shopify]);

  return (
    <s-page heading="Stores">
      {tier === "free" && (
        <s-banner tone="warning">
          <s-text>
            Upgrade to a paid plan to pair stores and start syncing content.
          </s-text>
        </s-banner>
      )}

      <s-section heading="Paired Stores">
        {pairings.length === 0 ? (
          <s-box padding="large-400">
            <s-stack direction="block" gap="base">
              <s-text>No stores paired yet.</s-text>
              {isPrimary && tier !== "free" && (
                <s-button onClick={() => setShowForm(true)}>
                  Pair a new store
                </s-button>
              )}
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {pairings.map((pairing) => (
              <s-card key={pairing.id}>
                <s-stack direction="inline" gap="base">
                  <s-stack direction="block" gap="tight">
                    <s-text variant="headingSm">
                      {pairing.role === "primary"
                        ? pairing.pairedShop
                        : pairing.primaryShop}
                    </s-text>
                    <s-stack direction="inline" gap="tight">
                      {pairing.label && (
                        <s-badge>{pairing.label}</s-badge>
                      )}
                      <s-badge
                        tone={
                          pairing.status === "active" ? "success" : "critical"
                        }
                      >
                        {pairing.status}
                      </s-badge>
                    </s-stack>
                    <s-text variant="bodySm" tone="subdued">
                      {pairing.lastSyncedAt
                        ? `Last synced: ${new Date(pairing.lastSyncedAt).toLocaleDateString()}`
                        : "Never synced"}
                    </s-text>
                  </s-stack>
                  {pairing.role === "primary" && (
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => {
                        fetcher.submit(
                          { _action: "remove", pairingId: pairing.id },
                          { method: "POST" },
                        );
                      }}
                      {...(isSubmitting ? { loading: true } : {})}
                    >
                      Remove
                    </s-button>
                  )}
                </s-stack>
              </s-card>
            ))}
            {canAddMore && (
              <s-button onClick={() => setShowForm(true)}>
                Pair another store
              </s-button>
            )}
          </s-stack>
        )}

        {!isPrimary && (
          <s-banner tone="info">
            <s-text>
              This store is paired with another store. Manage pairings from the
              primary store.
            </s-text>
          </s-banner>
        )}
      </s-section>

      {showForm && (
        <s-section heading="Pair a New Store">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Store domain"
              placeholder="my-dev-store.myshopify.com"
              value={domain}
              onInput={(e: any) => setDomain(e.target.value)}
              helpText="Enter the myshopify.com domain of the store to pair"
            />
            <s-text-field
              label="Label"
              placeholder="e.g. Development, Staging, QA"
              value={label}
              onInput={(e: any) => setLabel(e.target.value)}
              helpText="A name for this environment"
              maxLength={MAX_LABEL_LENGTH}
            />

            {fetcher.data && !fetcher.data.ok && fetcher.state === "idle" && (
              <s-banner tone="critical">
                <s-text>{fetcher.data.error}</s-text>
              </s-banner>
            )}

            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={() => {
                  fetcher.submit(
                    { _action: "create", domain, label },
                    { method: "POST" },
                  );
                }}
                {...(isSubmitting ? { loading: true } : {})}
              >
                Pair Store
              </s-button>
              <s-button variant="tertiary" onClick={() => setShowForm(false)}>
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
