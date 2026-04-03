import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../setup";

vi.mock("../../app/shopify.server", () => ({
  authenticate: { admin: vi.fn() },
}));

vi.mock("../../app/db.server", () => ({ default: prisma }));

vi.mock("../../app/utils/subscription.server", () => ({
  getSubscriptionStatus: vi.fn(),
}));

vi.mock("../../app/utils/admin-client.server", () => ({
  createStoreClient: vi.fn(),
  wrapAuthAdmin: vi.fn(),
}));

vi.mock("../../app/sync/index.server", () => ({
  generatePreview: vi.fn(),
}));

const { authenticate } = await import("../../app/shopify.server");
const { getSubscriptionStatus } = await import(
  "../../app/utils/subscription.server"
);
const { createStoreClient, wrapAuthAdmin } = await import(
  "../../app/utils/admin-client.server"
);
const { generatePreview } = await import("../../app/sync/index.server");
const { loader, action } = await import("../../app/routes/app.sync");

function mockAuth(shop: string) {
  const adminObj = { graphql: vi.fn() };
  vi.mocked(authenticate.admin).mockResolvedValue({
    admin: adminObj,
    session: { shop, id: `offline_${shop}` },
  } as any);
  return adminObj;
}

function mockSubscription(tier: string) {
  vi.mocked(getSubscriptionStatus).mockResolvedValue({
    tier: tier as any,
    isActive: tier !== "free",
    pairingLimit: tier === "free" ? 0 : 3,
    subscriptionName: tier === "free" ? null : tier,
  });
}

function makeRequest(
  method = "GET",
  body?: Record<string, string>,
) {
  if (method === "GET") {
    return new Request("http://localhost/app/sync");
  }
  const formData = new URLSearchParams(body);
  return new Request("http://localhost/app/sync", {
    method: "POST",
    body: formData,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("Sync Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loader", () => {
    it("returns pairings and tier for authenticated shop", async () => {
      mockAuth("primary.myshopify.com");
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

      expect(result.shop).toBe("primary.myshopify.com");
      expect(result.pairings).toHaveLength(1);
      expect(result.tier).toBe("pro");
      expect(result.canSync).toBe(true);
    });

    it("returns canSync false for free tier", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("free");

      const result = await loader({
        request: makeRequest(),
        params: {},
        context: {},
      });

      expect(result.canSync).toBe(false);
    });

    it("returns empty pairings when none exist", async () => {
      mockAuth("primary.myshopify.com");
      mockSubscription("pro");

      const result = await loader({
        request: makeRequest(),
        params: {},
        context: {},
      });

      expect(result.pairings).toHaveLength(0);
    });
  });

  describe("action", () => {
    it("returns error for missing pairing ID", async () => {
      mockAuth("primary.myshopify.com");

      const result = await action({
        request: makeRequest("POST", {
          _action: "preview",
          pairingId: "",
          direction: "push",
          resourceTypes: "products",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
    });

    it("returns error for no selected resource types", async () => {
      mockAuth("primary.myshopify.com");

      const result = await action({
        request: makeRequest("POST", {
          _action: "preview",
          pairingId: "some-id",
          direction: "push",
          resourceTypes: "",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("resource type");
      }
    });

    it("returns error for invalid pairing", async () => {
      mockAuth("primary.myshopify.com");

      const result = await action({
        request: makeRequest("POST", {
          _action: "preview",
          pairingId: "nonexistent-id",
          direction: "push",
          resourceTypes: "products",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid");
      }
    });

    it("returns error for pairing belonging to different shop", async () => {
      mockAuth("other.myshopify.com");

      const pairing = await prisma.storePairing.create({
        data: {
          primaryShop: "primary.myshopify.com",
          pairedShop: "dev.myshopify.com",
          status: "active",
        },
      });

      const result = await action({
        request: makeRequest("POST", {
          _action: "preview",
          pairingId: pairing.id,
          direction: "push",
          resourceTypes: "products",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
    });

    it("generates preview for valid push request", async () => {
      const adminObj = mockAuth("primary.myshopify.com");

      const pairing = await prisma.storePairing.create({
        data: {
          primaryShop: "primary.myshopify.com",
          pairedShop: "dev.myshopify.com",
          status: "active",
        },
      });

      const mockClient = { request: vi.fn() };
      vi.mocked(wrapAuthAdmin).mockReturnValue(mockClient as any);
      vi.mocked(createStoreClient).mockResolvedValue(mockClient as any);
      vi.mocked(generatePreview).mockResolvedValue({
        sourceShop: "primary.myshopify.com",
        targetShop: "dev.myshopify.com",
        direction: "push",
        results: [],
        totalCreate: 0,
        totalUpdate: 0,
        totalSkip: 0,
        generatedAt: new Date().toISOString(),
      });

      const result = await action({
        request: makeRequest("POST", {
          _action: "preview",
          pairingId: pairing.id,
          direction: "push",
          resourceTypes: "products,collections",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(true);
      expect(vi.mocked(generatePreview)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        ["products", "collections"],
        "primary.myshopify.com",
        "dev.myshopify.com",
        "push",
      );
    });

    it("swaps source/target for pull direction", async () => {
      mockAuth("primary.myshopify.com");

      const pairing = await prisma.storePairing.create({
        data: {
          primaryShop: "primary.myshopify.com",
          pairedShop: "dev.myshopify.com",
          status: "active",
        },
      });

      const mockClient = { request: vi.fn() };
      vi.mocked(wrapAuthAdmin).mockReturnValue(mockClient as any);
      vi.mocked(createStoreClient).mockResolvedValue(mockClient as any);
      vi.mocked(generatePreview).mockResolvedValue({
        sourceShop: "dev.myshopify.com",
        targetShop: "primary.myshopify.com",
        direction: "pull",
        results: [],
        totalCreate: 0,
        totalUpdate: 0,
        totalSkip: 0,
        generatedAt: new Date().toISOString(),
      });

      const result = await action({
        request: makeRequest("POST", {
          _action: "preview",
          pairingId: pairing.id,
          direction: "pull",
          resourceTypes: "products",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(true);
      expect(vi.mocked(generatePreview)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        ["products"],
        "dev.myshopify.com",
        "primary.myshopify.com",
        "pull",
      );
    });

    it("returns error when generatePreview throws", async () => {
      mockAuth("primary.myshopify.com");

      const pairing = await prisma.storePairing.create({
        data: {
          primaryShop: "primary.myshopify.com",
          pairedShop: "dev.myshopify.com",
          status: "active",
        },
      });

      vi.mocked(wrapAuthAdmin).mockReturnValue({ request: vi.fn() } as any);
      vi.mocked(createStoreClient).mockRejectedValue(
        new Error("No session found"),
      );

      const result = await action({
        request: makeRequest("POST", {
          _action: "preview",
          pairingId: pairing.id,
          direction: "push",
          resourceTypes: "products",
        }),
        params: {},
        context: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Failed to generate preview");
      }
    });
  });
});
