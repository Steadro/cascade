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
const { loader, action } = await import("../../app/routes/app.stores");

function mockAuth(shop: string) {
  vi.mocked(authenticate.admin).mockResolvedValue({
    admin: { graphql: vi.fn() },
    session: { shop, id: `offline_${shop}` },
  } as any);
}

function mockSubscription(tier: string, pairingLimit: number) {
  vi.mocked(getSubscriptionStatus).mockResolvedValue({
    tier: tier as any,
    isActive: tier !== "free",
    pairingLimit,
    subscriptionName: tier === "free" ? null : tier,
  });
}

function makeRequest(
  method = "GET",
  body?: Record<string, string>,
) {
  if (method === "GET") {
    return new Request("http://localhost/app/stores");
  }
  const formData = new URLSearchParams(body);
  return new Request("http://localhost/app/stores", {
    method: "POST",
    body: formData,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("Stores Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loader", () => {
    it("returns pairings for authenticated shop", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("pro", 1);

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

      expect(result.shop).toBe("primary.myshopify.com");
      expect(result.pairings).toHaveLength(1);
      expect(result.pairings[0].pairedShop).toBe("dev.myshopify.com");
      expect(result.tier).toBe("pro");
    });

    it("returns empty array when no pairings", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("pro", 1);

      const result = await loader({
        request: makeRequest(),
        params: {},
        context: {},
      });

      expect(result.pairings).toHaveLength(0);
    });

    it("includes tier and limit", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("business", 3);

      const result = await loader({
        request: makeRequest(),
        params: {},
        context: {},
      });

      expect(result.tier).toBe("business");
      expect(result.pairingLimit).toBe(3);
    });
  });

  describe("action", () => {
    it("creates pairing with valid data", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("pro", 1);

      await prisma.session.create({
        data: {
          id: "offline_target.myshopify.com",
          shop: "target.myshopify.com",
          state: "active",
          isOnline: false,
          accessToken: "token",
        },
      });

      const result = await action({
        request: makeRequest("POST", {
          _action: "create",
          domain: "target.myshopify.com",
          label: "Staging",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(true);
      if (result.ok && "pairing" in result) {
        expect(result.pairing.pairedShop).toBe("target.myshopify.com");
        expect(result.pairing.label).toBe("Staging");
      }
    });

    it("rejects missing domain", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("pro", 1);

      const result = await action({
        request: makeRequest("POST", { _action: "create", domain: "", label: "Dev" }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
    });

    it("rejects uninstalled target", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("pro", 1);

      const result = await action({
        request: makeRequest("POST", {
          _action: "create",
          domain: "not-installed.myshopify.com",
          label: "Dev",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Cascade must be installed");
      }
    });

    it("removes pairing for primary shop", async () => {
      mockAuth("primary.myshopify.com");

      const pairing = await prisma.storePairing.create({
        data: {
          primaryShop: "primary.myshopify.com",
          pairedShop: "dev.myshopify.com",
          status: "active",
        },
      });

      const result = await action({
        request: makeRequest("POST", {
          _action: "remove",
          pairingId: pairing.id,
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(true);

      const updated = await prisma.storePairing.findUnique({
        where: { id: pairing.id },
      });
      expect(updated!.status).toBe("disconnected");
    });

    it("rejects removal by non-primary shop", async () => {
      mockAuth("dev.myshopify.com");

      const pairing = await prisma.storePairing.create({
        data: {
          primaryShop: "primary.myshopify.com",
          pairedShop: "dev.myshopify.com",
          status: "active",
        },
      });

      const result = await action({
        request: makeRequest("POST", {
          _action: "remove",
          pairingId: pairing.id,
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Unable to remove pairing");
      }
    });
  });
});
