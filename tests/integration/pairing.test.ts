import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../setup";

// Mock db.server to use test prisma
vi.mock("../../app/db.server", () => ({ default: prisma }));

// Mock subscription utility
vi.mock("../../app/utils/subscription.server", () => ({
  getSubscriptionStatus: vi.fn(),
}));

const { getSubscriptionStatus } = await import(
  "../../app/utils/subscription.server"
);

const {
  validatePairingRequest,
  createPairing,
  removePairing,
  getPairingsForShop,
  getDashboardData,
} = await import("../../app/utils/pairing.server");

function mockAdmin() {
  return { graphql: vi.fn() };
}

function mockSubscription(tier: string, pairingLimit: number) {
  vi.mocked(getSubscriptionStatus).mockResolvedValue({
    tier: tier as any,
    isActive: tier !== "free",
    pairingLimit,
    subscriptionName: tier === "free" ? null : tier,
  });
}

async function createSession(shop: string, isOnline = false) {
  return prisma.session.create({
    data: {
      id: `offline_${shop}`,
      shop,
      state: "active",
      isOnline,
      accessToken: "test-token",
    },
  });
}

describe("validatePairingRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when target store has no session", async () => {
    mockSubscription("pro", 1);
    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "unknown.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Cascade must be installed");
    }
  });

  it("accepts when target store has offline session", async () => {
    mockSubscription("pro", 1);
    await createSession("target.myshopify.com", false);

    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "target.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects online-only sessions (not installed, just browsing)", async () => {
    mockSubscription("pro", 1);
    await createSession("target.myshopify.com", true);

    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "target.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Cascade must be installed");
    }
  });

  it("rejects self-pairing", async () => {
    mockSubscription("pro", 1);
    await createSession("primary.myshopify.com", false);

    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "primary.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Cannot pair a store with itself");
    }
  });

  it("rejects duplicate active pairing", async () => {
    mockSubscription("business", 3);
    await createSession("target.myshopify.com", false);
    await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "target.myshopify.com",
        status: "active",
      },
    });

    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "target.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Already paired");
    }
  });

  it("returns reactivate flag for disconnected pairing", async () => {
    mockSubscription("pro", 1);
    await createSession("target.myshopify.com", false);
    const existing = await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "target.myshopify.com",
        status: "disconnected",
      },
    });

    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "target.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reactivateId).toBe(existing.id);
    }
  });

  it("enforces free tier limit (0)", async () => {
    mockSubscription("free", 0);
    await createSession("target.myshopify.com", false);

    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "target.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Upgrade");
    }
  });

  it("enforces pro tier limit (1)", async () => {
    mockSubscription("pro", 1);
    await createSession("dev1.myshopify.com", false);
    await createSession("dev2.myshopify.com", false);

    await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev1.myshopify.com",
        status: "active",
      },
    });

    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "dev2.myshopify.com",
      mockAdmin(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("plan allows 1");
    }
  });

  it("rejects invalid domain format", async () => {
    mockSubscription("pro", 1);
    const result = await validatePairingRequest(
      "primary.myshopify.com",
      "not valid!!",
      mockAdmin(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid store domain");
    }
  });
});

describe("createPairing", () => {
  it("creates a new pairing with correct fields", async () => {
    const pairing = await createPairing(
      "primary.myshopify.com",
      "dev.myshopify.com",
      "Development",
    );

    expect(pairing.primaryShop).toBe("primary.myshopify.com");
    expect(pairing.pairedShop).toBe("dev.myshopify.com");
    expect(pairing.label).toBe("Development");
    expect(pairing.status).toBe("active");
  });

  it("reactivates a disconnected pairing", async () => {
    const original = await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        label: "Old Label",
        status: "disconnected",
      },
    });

    const reactivated = await createPairing(
      "primary.myshopify.com",
      "dev.myshopify.com",
      "Staging",
    );

    expect(reactivated.id).toBe(original.id);
    expect(reactivated.status).toBe("active");
    expect(reactivated.label).toBe("Staging");
  });

  it("normalizes domain when creating", async () => {
    const pairing = await createPairing(
      "primary.myshopify.com",
      "DEV-STORE",
      "Development",
    );

    expect(pairing.pairedShop).toBe("dev-store.myshopify.com");
  });
});

describe("removePairing", () => {
  it("soft-deletes by setting status to disconnected", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "active",
      },
    });

    await removePairing("primary.myshopify.com", pairing.id);

    const updated = await prisma.storePairing.findUnique({
      where: { id: pairing.id },
    });
    expect(updated!.status).toBe("disconnected");
  });

  it("rejects if shop is not the primary", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "active",
      },
    });

    await expect(
      removePairing("dev.myshopify.com", pairing.id),
    ).rejects.toThrow("Only the primary store can remove pairings");
  });

  it("rejects if pairing not found", async () => {
    await expect(
      removePairing("primary.myshopify.com", "nonexistent-id"),
    ).rejects.toThrow("Pairing not found");
  });
});

describe("getPairingsForShop", () => {
  it("returns pairings where shop is primary", async () => {
    await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "active",
      },
    });

    const pairings = await getPairingsForShop("primary.myshopify.com");
    expect(pairings).toHaveLength(1);
    expect(pairings[0].role).toBe("primary");
  });

  it("returns pairings where shop is paired", async () => {
    await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "active",
      },
    });

    const pairings = await getPairingsForShop("dev.myshopify.com");
    expect(pairings).toHaveLength(1);
    expect(pairings[0].role).toBe("paired");
  });

  it("excludes disconnected pairings", async () => {
    await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "disconnected",
      },
    });

    const pairings = await getPairingsForShop("primary.myshopify.com");
    expect(pairings).toHaveLength(0);
  });

  it("does not return pairings for other shops", async () => {
    await prisma.storePairing.create({
      data: {
        primaryShop: "other.myshopify.com",
        pairedShop: "other-dev.myshopify.com",
        status: "active",
      },
    });

    const pairings = await getPairingsForShop("primary.myshopify.com");
    expect(pairings).toHaveLength(0);
  });
});

describe("getDashboardData", () => {
  it("returns empty state when no pairings", async () => {
    const data = await getDashboardData("primary.myshopify.com");
    expect(data.hasPairings).toBe(false);
    expect(data.pairings).toHaveLength(0);
    expect(data.recentJobs).toHaveLength(0);
  });

  it("returns pairings and recent jobs", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "active",
      },
    });

    await prisma.syncJob.create({
      data: {
        pairingId: pairing.id,
        sourceShop: "primary.myshopify.com",
        targetShop: "dev.myshopify.com",
        resourceTypes: '["Product"]',
        status: "completed",
      },
    });

    const data = await getDashboardData("primary.myshopify.com");
    expect(data.hasPairings).toBe(true);
    expect(data.pairings).toHaveLength(1);
    expect(data.recentJobs).toHaveLength(1);
  });

  it("limits recent jobs to 5", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "primary.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "active",
      },
    });

    for (let i = 0; i < 8; i++) {
      await prisma.syncJob.create({
        data: {
          pairingId: pairing.id,
          sourceShop: "primary.myshopify.com",
          targetShop: "dev.myshopify.com",
          resourceTypes: '["Product"]',
          status: "completed",
        },
      });
    }

    const data = await getDashboardData("primary.myshopify.com");
    expect(data.recentJobs).toHaveLength(5);
  });
});
