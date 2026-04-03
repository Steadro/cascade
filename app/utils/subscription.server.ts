type PlanTier = "free" | "pro" | "business" | "enterprise";

interface SubscriptionStatus {
  tier: PlanTier;
  isActive: boolean;
  pairingLimit: number;
  subscriptionName: string | null;
}

const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  business: 3,
  enterprise: Infinity,
} as const;

const SUBSCRIPTION_QUERY = `#graphql
  query {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

function determineTier(subscriptionName: string): PlanTier {
  const name = subscriptionName.toLowerCase();
  if (name.includes("enterprise")) return "enterprise";
  if (name.includes("business")) return "business";
  if (name.includes("pro")) return "pro";

  console.warn(`Unrecognized subscription plan name: "${subscriptionName}"`);
  return "free";
}

// WA-001: Default tier when no subscription is found.
// Set to "business" until Managed Pricing plans are created in Partner Dashboard.
// Change to "free" before App Store submission.
// See /docs/DECISIONS.md for removal checklist.
const DEFAULT_TIER: PlanTier = "business";

export async function getSubscriptionStatus(
  admin: { graphql: (query: string) => Promise<Response> },
): Promise<SubscriptionStatus> {
  const response = await admin.graphql(SUBSCRIPTION_QUERY);
  const json = await response.json();

  const subscriptions =
    json.data?.currentAppInstallation?.activeSubscriptions ?? [];

  const activeSub = subscriptions.find(
    (sub: { status: string }) => sub.status === "ACTIVE",
  );

  if (!activeSub) {
    return {
      tier: DEFAULT_TIER,
      isActive: DEFAULT_TIER !== "free",
      pairingLimit: PLAN_LIMITS[DEFAULT_TIER],
      subscriptionName: null,
    };
  }

  const tier = determineTier(activeSub.name);

  return {
    tier,
    isActive: true,
    pairingLimit: PLAN_LIMITS[tier],
    subscriptionName: activeSub.name,
  };
}
