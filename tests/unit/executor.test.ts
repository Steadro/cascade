import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  syncJob: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  resourceMap: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  storePairing: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("../../app/db.server", () => ({ default: mockPrisma }));

const mockTargetRequest = vi.fn();
const mockSourceRequest = vi.fn();

vi.mock("../../app/utils/admin-client.server", () => ({
  createStoreClient: vi.fn((shop: string) => ({
    request: shop.includes("source") ? mockSourceRequest : mockTargetRequest,
  })),
}));

vi.mock("../../app/sync/rate-limiter.server", () => ({
  createRateLimitedClient: vi.fn((client: unknown) => client),
}));

vi.mock("../../app/sync/cdn-rewriter.server", () => ({
  rewriteCdnUrls: vi.fn(async (html: string) => ({
    html,
    rewrittenCount: 0,
    failedCount: 0,
    failures: [],
  })),
}));

const { executeSync } = await import("../../app/sync/executor.server");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockResolvedValue([]);
  mockPrisma.resourceMap.findMany.mockResolvedValue([]);
  mockPrisma.syncJob.update.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    pairingId: "pair-1",
    sourceShop: "source.myshopify.com",
    targetShop: "target.myshopify.com",
    resourceTypes: JSON.stringify(["urlRedirects"]),
    status: "pending",
    progress: 0,
    totalItems: 0,
    processedItems: 0,
    errors: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function mockPairingGuard() {
  mockPrisma.storePairing.findFirst.mockResolvedValue({
    id: "pair-1",
    primaryShop: "source.myshopify.com",
    pairedShop: "target.myshopify.com",
    label: null,
  });
}

function mockPublicationsQuery() {
  mockTargetRequest.mockResolvedValueOnce({
    data: {
      publications: {
        nodes: [
          { id: "gid://shopify/Publication/1", name: "Online Store", supportsFuturePublishing: true },
        ],
      },
    },
  });
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeSync", () => {
  it("throws when job is not found", async () => {
    mockPrisma.syncJob.findUnique.mockResolvedValue(null);

    await expect(executeSync("missing")).rejects.toThrow("not found");
  });

  it("throws when job is not pending", async () => {
    mockPrisma.syncJob.findUnique.mockResolvedValue(makeJob({ status: "running" }));

    await expect(executeSync("job-1")).rejects.toThrow("expected pending");
  });

  it("sets status to running, then completed on success", async () => {
    mockPrisma.syncJob.findUnique.mockResolvedValue(makeJob());
    mockPairingGuard();
    mockPublicationsQuery();

    // Source returns one redirect
    mockSourceRequest.mockResolvedValue({
      data: {
        urlRedirects: {
          nodes: [{ id: "gid://shopify/UrlRedirect/1", path: "/old", target: "/new" }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    // Target returns empty (so it's a "create")
    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirects: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    // Mutation response
    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirectCreate: {
          urlRedirect: { id: "gid://shopify/UrlRedirect/100" },
          userErrors: [],
        },
      },
    });

    await executeSync("job-1");

    // Check it was set to running
    expect(mockPrisma.syncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "running" }),
      }),
    );

    // Check it was set to completed
    const lastUpdate = mockPrisma.syncJob.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data?.status).toBe("completed");
    expect(lastUpdate?.data?.progress).toBe(100);
  });

  it("sets status to failed when all items error", async () => {
    mockPrisma.syncJob.findUnique.mockResolvedValue(makeJob());
    mockPairingGuard();
    mockPublicationsQuery();

    mockSourceRequest.mockResolvedValue({
      data: {
        urlRedirects: {
          nodes: [{ id: "gid://shopify/UrlRedirect/1", path: "/old", target: "/new" }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirects: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    // Mutation fails with userErrors
    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirectCreate: {
          urlRedirect: null,
          userErrors: [{ message: "Path already exists" }],
        },
      },
    });

    await executeSync("job-1");

    const lastUpdate = mockPrisma.syncJob.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data?.status).toBe("failed");
    expect(lastUpdate?.data?.errors).toContain("Path already exists");
  });

  it("sets status to failed when pairing guard throws", async () => {
    mockPrisma.syncJob.findUnique.mockResolvedValue(makeJob());
    mockPrisma.storePairing.findFirst.mockResolvedValue(null);

    await executeSync("job-1");

    const lastUpdate = mockPrisma.syncJob.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data?.status).toBe("failed");
    expect(lastUpdate?.data?.errors).toContain("No active pairing");
  });

  it("continues processing after individual item errors", async () => {
    mockPrisma.syncJob.findUnique.mockResolvedValue(makeJob());
    mockPairingGuard();
    mockPublicationsQuery();

    // Source returns two redirects
    mockSourceRequest.mockResolvedValue({
      data: {
        urlRedirects: {
          nodes: [
            { id: "gid://shopify/UrlRedirect/1", path: "/a", target: "/b" },
            { id: "gid://shopify/UrlRedirect/2", path: "/c", target: "/d" },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    // Target empty
    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirects: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    // First mutation fails
    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirectCreate: {
          urlRedirect: null,
          userErrors: [{ message: "Error on first" }],
        },
      },
    });

    // Second mutation succeeds
    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirectCreate: {
          urlRedirect: { id: "gid://shopify/UrlRedirect/200" },
          userErrors: [],
        },
      },
    });

    await executeSync("job-1");

    // Should be completed (not all failed)
    const lastUpdate = mockPrisma.syncJob.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data?.status).toBe("completed");
    expect(lastUpdate?.data?.errors).toContain("Error on first");
  });

  it("skips items with skip action", async () => {
    mockPrisma.syncJob.findUnique.mockResolvedValue(makeJob());
    mockPairingGuard();
    mockPublicationsQuery();

    // Same redirect on both sides → skip
    const redirect = { id: "gid://shopify/UrlRedirect/1", path: "/old", target: "/new" };
    mockSourceRequest.mockResolvedValue({
      data: {
        urlRedirects: {
          nodes: [redirect],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    mockTargetRequest.mockResolvedValueOnce({
      data: {
        urlRedirects: {
          nodes: [redirect],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    await executeSync("job-1");

    // Completed with 0 items
    const totalUpdate = mockPrisma.syncJob.update.mock.calls.find(
      (c: Array<{ data?: { totalItems?: number } }>) => c[0]?.data?.totalItems !== undefined,
    );
    expect(totalUpdate?.[0]?.data?.totalItems).toBe(0);
  });
});
