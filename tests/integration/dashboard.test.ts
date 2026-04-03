import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../setup";

vi.mock("../../app/shopify.server", () => ({
  authenticate: { admin: vi.fn() },
}));

vi.mock("../../app/db.server", () => ({ default: prisma }));

vi.mock("../../app/utils/subscription.server", () => ({
  getSubscriptionStatus: vi.fn(),
}));

const { authenticate } = await import("../../app/shopify.server");
const { getSubscriptionStatus } = await import(
  "../../app/utils/subscription.server"
);
const { loader } = await import("../../app/routes/app._index");

function mockAuth(shop: string) {
  vi.mocked(authenticate.admin).mockResolvedValue({
    admin: { graphql: vi.fn() },
    session: { shop, id: `offline_${shop}` },
  } as any);
}

function mockSubscription(tier: string) {
  vi.mocked(getSubscriptionStatus).mockResolvedValue({
    tier: tier as any,
    isActive: tier !== "free",
    pairingLimit: tier === "free" ? 0 : 3,
    subscriptionName: tier === "free" ? null : tier,
  });
}

function makeRequest() {
  return new Request("http://localhost/app");
}

describe("Dashboard Loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty state when no pairings", async () => {
    mockAuth("primary.myshopify.com");
    mockSubscription("pro");

    const result = await loader({
      request: makeRequest(),
      params: {},
      context: {},
    });

    expect(result.hasPairings).toBe(false);
    expect(result.pairings).toHaveLength(0);
    expect(result.recentJobs).toHaveLength(0);
    expect(result.shop).toBe("primary.myshopify.com");
    expect(result.tier).toBe("pro");
  });

  it("returns pairings and recent jobs", async () => {
    mockAuth("primary.myshopify.com");
    mockSubscription("business");

    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        label: "Development",
        status: "active",
      },
    });

    await prisma.syncJob.create({
      data: {
        pairingId: pairing.id,
        sourceShop: "primary.myshopify.com",
        targetShop: "dev.myshopify.com",
        resourceTypes: '["Product","Collection"]',
        status: "completed",
        completedAt: new Date(),
      },
    });

    const result = await loader({
      request: makeRequest(),
      params: {},
      context: {},
    });

    expect(result.hasPairings).toBe(true);
    expect(result.pairings).toHaveLength(1);
    expect(result.pairings[0].role).toBe("primary");
    expect(result.recentJobs).toHaveLength(1);
  });

  it("returns correct role when shop is paired", async () => {
    mockAuth("dev.myshopify.com");
    mockSubscription("pro");

    await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        label: "Development",
        status: "active",
      },
    });

    const result = await loader({
      request: makeRequest(),
      params: {},
      context: {},
    });

    expect(result.pairings[0].role).toBe("paired");
  });

  it("scopes data to authenticated shop only", async () => {
    mockAuth("primary.myshopify.com");
    mockSubscription("pro");

    // Create pairing for a different shop
    await prisma.storePairing.create({
      data: {
        primaryShop: "other.myshopify.com",
        pairedShop: "other-dev.myshopify.com",
        status: "active",
      },
    });

    const result = await loader({
      request: makeRequest(),
      params: {},
      context: {},
    });

    expect(result.pairings).toHaveLength(0);
    expect(result.hasPairings).toBe(false);
  });

  it("returns isActive false for free tier", async () => {
    mockAuth("primary.myshopify.com");
    mockSubscription("free");

    const result = await loader({
      request: makeRequest(),
      params: {},
      context: {},
    });

    expect(result.isActive).toBe(false);
    expect(result.tier).toBe("free");
  });
});
