import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../setup";

// Mock the shopify.server authenticate module
vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
  },
}));

vi.mock("../../app/db.server", () => ({
  default: prisma,
}));

// Import the action after mocking
const { action } = await import("../../app/routes/webhooks");
const { authenticate } = await import("../../app/shopify.server");

function makeRequest(method = "POST") {
  return new Request("http://localhost/webhooks", { method });
}

describe("Webhook Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("APP_UNINSTALLED", () => {
    it("deletes all sessions for the shop", async () => {
      await prisma.session.create({
        data: {
          id: "offline_shop1.myshopify.com",
          shop: "shop1.myshopify.com",
          state: "active",
          isOnline: false,
          accessToken: "token123",
        },
      });

      vi.mocked(authenticate.webhook).mockResolvedValue({
        shop: "shop1.myshopify.com",
        session: { id: "offline_shop1.myshopify.com" },
        topic: "APP_UNINSTALLED",
        payload: {},
      } as any);

      const response = await action({ request: makeRequest(), params: {}, context: {} } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);

      const sessions = await prisma.session.findMany({
        where: { shop: "shop1.myshopify.com" },
      });
      expect(sessions).toHaveLength(0);
    });

    it("handles missing session gracefully", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        shop: "shop1.myshopify.com",
        session: undefined,
        topic: "APP_UNINSTALLED",
        payload: {},
      } as any);

      const response = await action({ request: makeRequest(), params: {}, context: {} } as any);
      expect(response.status).toBe(200);
    });
  });

  describe("APP_SCOPES_UPDATE", () => {
    it("updates session scope from payload", async () => {
      await prisma.session.create({
        data: {
          id: "offline_shop1.myshopify.com",
          shop: "shop1.myshopify.com",
          state: "active",
          isOnline: false,
          accessToken: "token123",
          scope: "read_products",
        },
      });

      vi.mocked(authenticate.webhook).mockResolvedValue({
        shop: "shop1.myshopify.com",
        session: { id: "offline_shop1.myshopify.com" },
        topic: "APP_SCOPES_UPDATE",
        payload: { current: ["read_products", "write_products"] },
      } as any);

      const response = await action({ request: makeRequest(), params: {}, context: {} } as any);
      expect(response.status).toBe(200);

      const session = await prisma.session.findUnique({
        where: { id: "offline_shop1.myshopify.com" },
      });
      expect(session!.scope).toBe("read_products,write_products");
    });
  });

  describe("CUSTOMERS_DATA_REQUEST", () => {
    it("returns 200 without modifying data", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        shop: "shop1.myshopify.com",
        session: { id: "offline_shop1.myshopify.com" },
        topic: "CUSTOMERS_DATA_REQUEST",
        payload: {},
      } as any);

      const response = await action({ request: makeRequest(), params: {}, context: {} } as any);
      expect(response.status).toBe(200);
    });
  });

  describe("CUSTOMERS_REDACT", () => {
    it("returns 200 without modifying data", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        shop: "shop1.myshopify.com",
        session: { id: "offline_shop1.myshopify.com" },
        topic: "CUSTOMERS_REDACT",
        payload: {},
      } as any);

      const response = await action({ request: makeRequest(), params: {}, context: {} } as any);
      expect(response.status).toBe(200);
    });
  });

  describe("SHOP_REDACT", () => {
    it("deletes all pairings and sessions for the shop", async () => {
      await prisma.session.create({
        data: {
          id: "offline_shop1.myshopify.com",
          shop: "shop1.myshopify.com",
          state: "active",
          isOnline: false,
          accessToken: "token123",
        },
      });

      const pairing1 = await prisma.storePairing.create({
        data: {
          primaryShop: "shop1.myshopify.com",
          pairedShop: "dev.myshopify.com",
        },
      });

      const pairing2 = await prisma.storePairing.create({
        data: {
          primaryShop: "other.myshopify.com",
          pairedShop: "shop1.myshopify.com",
        },
      });

      await prisma.resourceMap.create({
        data: {
          pairingId: pairing1.id,
          resourceType: "Product",
          sourceId: "gid://shopify/Product/1",
          targetId: "gid://shopify/Product/2",
        },
      });

      await prisma.syncJob.create({
        data: {
          pairingId: pairing2.id,
          sourceShop: "other.myshopify.com",
          targetShop: "shop1.myshopify.com",
          resourceTypes: '["Product"]',
        },
      });

      vi.mocked(authenticate.webhook).mockResolvedValue({
        shop: "shop1.myshopify.com",
        session: undefined,
        topic: "SHOP_REDACT",
        payload: {},
      } as any);

      const response = await action({ request: makeRequest(), params: {}, context: {} } as any);
      expect(response.status).toBe(200);

      // All pairings involving this shop should be deleted
      const pairings = await prisma.storePairing.findMany({
        where: {
          OR: [
            { primaryShop: "shop1.myshopify.com" },
            { pairedShop: "shop1.myshopify.com" },
          ],
        },
      });
      expect(pairings).toHaveLength(0);

      // Explicit deletes should have removed resource maps and sync jobs
      const maps = await prisma.resourceMap.findMany();
      expect(maps).toHaveLength(0);

      const jobs = await prisma.syncJob.findMany();
      expect(jobs).toHaveLength(0);

      // Sessions should be deleted
      const sessions = await prisma.session.findMany({
        where: { shop: "shop1.myshopify.com" },
      });
      expect(sessions).toHaveLength(0);
    });
  });

  describe("Error handling", () => {
    it("returns 200 on non-Response errors (e.g. database failures)", async () => {
      vi.mocked(authenticate.webhook).mockRejectedValue(
        new Error("Database connection lost"),
      );

      const response = await action({ request: makeRequest(), params: {}, context: {} } as any);
      expect(response.status).toBe(200);
    });

    it("re-throws Response objects from auth failures", async () => {
      vi.mocked(authenticate.webhook).mockRejectedValue(
        new Response("Unauthorized", { status: 401 }),
      );

      await expect(
        action({ request: makeRequest(), params: {}, context: {} } as any),
      ).rejects.toBeInstanceOf(Response);
    });
  });
});
