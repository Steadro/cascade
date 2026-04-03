import { describe, it, expect, vi } from "vitest";
import { getSubscriptionStatus } from "../../app/utils/subscription.server";

function mockAdmin(responseData: any) {
  return {
    graphql: vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: responseData }),
    }),
  };
}

describe("getSubscriptionStatus", () => {
  it("returns free tier when no active subscriptions", async () => {
    const admin = mockAdmin({
      currentAppInstallation: { activeSubscriptions: [] },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("free");
    expect(status.isActive).toBe(false);
    expect(status.pairingLimit).toBe(0);
    expect(status.subscriptionName).toBeNull();
  });

  it("returns free tier when subscription is not ACTIVE", async () => {
    const admin = mockAdmin({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "1", name: "Pro", status: "PENDING", lineItems: [] },
        ],
      },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("free");
    expect(status.isActive).toBe(false);
  });

  it("detects Pro tier", async () => {
    const admin = mockAdmin({
      currentAppInstallation: {
        activeSubscriptions: [
          {
            id: "1",
            name: "Pro",
            status: "ACTIVE",
            lineItems: [
              {
                plan: {
                  pricingDetails: {
                    price: { amount: "49.00", currencyCode: "USD" },
                    interval: "EVERY_30_DAYS",
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("pro");
    expect(status.isActive).toBe(true);
    expect(status.pairingLimit).toBe(1);
    expect(status.subscriptionName).toBe("Pro");
  });

  it("detects Business tier", async () => {
    const admin = mockAdmin({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "1", name: "Business", status: "ACTIVE", lineItems: [] },
        ],
      },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("business");
    expect(status.isActive).toBe(true);
    expect(status.pairingLimit).toBe(3);
  });

  it("detects Enterprise tier", async () => {
    const admin = mockAdmin({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "1", name: "Enterprise", status: "ACTIVE", lineItems: [] },
        ],
      },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("enterprise");
    expect(status.isActive).toBe(true);
    expect(status.pairingLimit).toBe(Infinity);
  });

  it("handles case-insensitive plan names", async () => {
    const admin = mockAdmin({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "1", name: "cascade pro plan", status: "ACTIVE", lineItems: [] },
        ],
      },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("pro");
  });

  it("defaults to free for unrecognized plan names", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const admin = mockAdmin({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "1", name: "Unknown Plan", status: "ACTIVE", lineItems: [] },
        ],
      },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("free");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unrecognized subscription plan name"),
    );

    consoleSpy.mockRestore();
  });

  it("handles null/missing activeSubscriptions", async () => {
    const admin = mockAdmin({
      currentAppInstallation: { activeSubscriptions: null },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("free");
    expect(status.isActive).toBe(false);
  });

  it("picks first ACTIVE subscription when multiple exist", async () => {
    const admin = mockAdmin({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "1", name: "Pro", status: "CANCELLED", lineItems: [] },
          { id: "2", name: "Business", status: "ACTIVE", lineItems: [] },
        ],
      },
    });

    const status = await getSubscriptionStatus(admin);

    expect(status.tier).toBe("business");
    expect(status.subscriptionName).toBe("Business");
  });

  describe("DEV_PLAN_OVERRIDE", () => {
    it("returns overridden tier when env var is set", async () => {
      process.env.DEV_PLAN_OVERRIDE = "business";

      const admin = mockAdmin({
        currentAppInstallation: { activeSubscriptions: [] },
      });

      const status = await getSubscriptionStatus(admin);

      expect(status.tier).toBe("business");
      expect(status.isActive).toBe(true);
      expect(status.pairingLimit).toBe(3);
      expect(status.subscriptionName).toContain("DEV");
      expect(admin.graphql).not.toHaveBeenCalled();

      delete process.env.DEV_PLAN_OVERRIDE;
    });

    it("ignores invalid override values", async () => {
      process.env.DEV_PLAN_OVERRIDE = "invalid_tier";

      const admin = mockAdmin({
        currentAppInstallation: { activeSubscriptions: [] },
      });

      const status = await getSubscriptionStatus(admin);

      expect(status.tier).toBe("free");
      expect(admin.graphql).toHaveBeenCalled();

      delete process.env.DEV_PLAN_OVERRIDE;
    });
  });
});
