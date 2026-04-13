import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  storePairing: {
    findFirst: vi.fn(),
  },
};

vi.mock("../../app/db.server", () => ({ default: mockPrisma }));

const { assertShopIsPaired } = await import(
  "../../app/sync/guards.server"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertShopIsPaired", () => {
  const activePairing = {
    id: "pair-1",
    primaryShop: "store-a.myshopify.com",
    pairedShop: "store-b.myshopify.com",
    label: "Test pairing",
  };

  it("returns pairing when authenticated shop is primaryShop", async () => {
    mockPrisma.storePairing.findFirst.mockResolvedValue(activePairing);

    const result = await assertShopIsPaired(
      "store-a.myshopify.com",
      "pair-1",
    );

    expect(result).toEqual({
      pairingId: "pair-1",
      primaryShop: "store-a.myshopify.com",
      pairedShop: "store-b.myshopify.com",
      label: "Test pairing",
    });

    expect(mockPrisma.storePairing.findFirst).toHaveBeenCalledWith({
      where: {
        id: "pair-1",
        status: "active",
        OR: [
          { primaryShop: "store-a.myshopify.com" },
          { pairedShop: "store-a.myshopify.com" },
        ],
      },
      select: {
        id: true,
        primaryShop: true,
        pairedShop: true,
        label: true,
      },
    });
  });

  it("returns pairing when authenticated shop is pairedShop", async () => {
    mockPrisma.storePairing.findFirst.mockResolvedValue(activePairing);

    const result = await assertShopIsPaired(
      "store-b.myshopify.com",
      "pair-1",
    );

    expect(result.pairedShop).toBe("store-b.myshopify.com");
  });

  it("throws when no active pairing found", async () => {
    mockPrisma.storePairing.findFirst.mockResolvedValue(null);

    await expect(
      assertShopIsPaired("unknown-shop.myshopify.com", "pair-99"),
    ).rejects.toThrow(
      'No active pairing found for shop "unknown-shop.myshopify.com" with pairing ID "pair-99"',
    );
  });

  it("returns null label when pairing has no label", async () => {
    mockPrisma.storePairing.findFirst.mockResolvedValue({
      ...activePairing,
      label: null,
    });

    const result = await assertShopIsPaired(
      "store-a.myshopify.com",
      "pair-1",
    );

    expect(result.label).toBeNull();
  });
});
