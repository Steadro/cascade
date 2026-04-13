import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  resourceMap: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("../../app/db.server", () => ({ default: mockPrisma }));

const { IdRemapper } = await import("../../app/sync/id-remapper.server");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IdRemapper", () => {
  const PAIRING_ID = "pair-1";

  describe("loadMappings", () => {
    it("populates map from DB rows", async () => {
      mockPrisma.resourceMap.findMany.mockResolvedValue([
        { sourceId: "gid://shopify/Product/1", targetId: "gid://shopify/Product/100", resourceType: "products", handle: "widget" },
        { sourceId: "gid://shopify/Product/2", targetId: "gid://shopify/Product/200", resourceType: "products", handle: "gadget" },
        { sourceId: "gid://shopify/Collection/3", targetId: "gid://shopify/Collection/300", resourceType: "collections", handle: "summer" },
      ]);

      const remapper = new IdRemapper(PAIRING_ID);
      const count = await remapper.loadMappings();

      expect(count).toBe(3);
      expect(remapper.size).toBe(3);
      expect(remapper.getTargetId("gid://shopify/Product/1")).toBe("gid://shopify/Product/100");
      expect(remapper.getTargetId("gid://shopify/Product/2")).toBe("gid://shopify/Product/200");
      expect(remapper.getTargetId("gid://shopify/Collection/3")).toBe("gid://shopify/Collection/300");

      expect(mockPrisma.resourceMap.findMany).toHaveBeenCalledWith({
        where: { pairingId: PAIRING_ID },
        select: { sourceId: true, targetId: true, resourceType: true, handle: true },
      });
    });
  });

  describe("getTargetId", () => {
    it("returns null for unknown sourceId", () => {
      const remapper = new IdRemapper(PAIRING_ID);
      expect(remapper.getTargetId("gid://shopify/Product/999")).toBeNull();
    });
  });

  describe("getTargetIdByHandle", () => {
    it("returns correct targetId", async () => {
      mockPrisma.resourceMap.findMany.mockResolvedValue([
        { sourceId: "gid://shopify/Product/1", targetId: "gid://shopify/Product/100", resourceType: "products", handle: "widget" },
      ]);

      const remapper = new IdRemapper(PAIRING_ID);
      await remapper.loadMappings();

      expect(remapper.getTargetIdByHandle("widget", "products")).toBe("gid://shopify/Product/100");
      expect(remapper.getTargetIdByHandle("widget", "collections")).toBeNull();
      expect(remapper.getTargetIdByHandle("unknown", "products")).toBeNull();
    });
  });

  describe("addMapping", () => {
    it("stores in memory immediately before flush", async () => {
      mockPrisma.$transaction.mockResolvedValue([]);

      const remapper = new IdRemapper(PAIRING_ID, { flushThreshold: 100 });
      await remapper.addMapping(
        "gid://shopify/Product/1",
        "gid://shopify/Product/100",
        "products",
        "widget",
      );

      expect(remapper.getTargetId("gid://shopify/Product/1")).toBe("gid://shopify/Product/100");
      expect(remapper.getTargetIdByHandle("widget", "products")).toBe("gid://shopify/Product/100");
      expect(remapper.size).toBe(1);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("auto-flushes at threshold", async () => {
      mockPrisma.$transaction.mockResolvedValue([]);

      const remapper = new IdRemapper(PAIRING_ID, { flushThreshold: 2 });
      await remapper.addMapping("s1", "t1", "products", "h1");
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();

      await remapper.addMapping("s2", "t2", "products", "h2");
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("overwrites existing mapping in memory", async () => {
      const remapper = new IdRemapper(PAIRING_ID, { flushThreshold: 100 });
      await remapper.addMapping("s1", "t-old", "products", "widget");
      await remapper.addMapping("s1", "t-new", "products", "widget");

      expect(remapper.getTargetId("s1")).toBe("t-new");
      expect(remapper.size).toBe(1);
    });
  });

  describe("flush", () => {
    it("writes all pending mappings via upsert transaction", async () => {
      mockPrisma.$transaction.mockResolvedValue([]);
      mockPrisma.resourceMap.upsert.mockResolvedValue({});

      const remapper = new IdRemapper(PAIRING_ID, { flushThreshold: 100 });
      await remapper.addMapping("s1", "t1", "products", "widget");
      await remapper.addMapping("s2", "t2", "collections", "summer");
      await remapper.flush();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toHaveLength(2);
    });

    it("is idempotent when called with no pending writes", async () => {
      const remapper = new IdRemapper(PAIRING_ID);
      await remapper.flush();

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("clears pending writes after flush", async () => {
      mockPrisma.$transaction.mockResolvedValue([]);

      const remapper = new IdRemapper(PAIRING_ID, { flushThreshold: 100 });
      await remapper.addMapping("s1", "t1", "products", "widget");
      await remapper.flush();
      await remapper.flush();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
