import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimitedClient } from "../../app/sync/rate-limiter.server";
import type { StoreClient, StoreClientResponse } from "../../app/sync/types";

function makeClient(
  handler: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<StoreClientResponse>,
): StoreClient {
  return { request: handler };
}

function okResponse(
  data: Record<string, unknown> = {},
  extensions?: Record<string, unknown>,
): StoreClientResponse {
  return { data, extensions };
}

function throttledResponse(): StoreClientResponse {
  return {
    errors: [{ message: "Throttled" }],
    extensions: {
      cost: {
        throttleStatus: {
          maximumAvailable: 1000,
          currentlyAvailable: 100,
          restoreRate: 50,
        },
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimitedClient", () => {
  it("passes through successful responses", async () => {
    const inner = makeClient(async () => okResponse({ products: [] }));
    const client = createRateLimitedClient(inner);

    const result = await client.request("{ products { edges { node { id } } } }");

    expect(result.data).toEqual({ products: [] });
  });

  it("retries on throttled errors with exponential backoff", async () => {
    let callCount = 0;
    const inner = makeClient(async () => {
      callCount += 1;
      if (callCount <= 2) return throttledResponse();
      return okResponse({ products: [] });
    });

    const client = createRateLimitedClient(inner, {
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });

    const promise = client.request("{ products { edges { node { id } } } }");

    // Advance past retry 1 backoff (100ms) and retry 2 backoff (200ms)
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result.data).toEqual({ products: [] });
    expect(callCount).toBe(3);
  });

  it("returns last response after max throttle retries", async () => {
    const inner = makeClient(async () => throttledResponse());
    const client = createRateLimitedClient(inner, {
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 400,
    });

    const promise = client.request("query");

    // Advance enough to cover: retry 1 (100ms) + retry 2 (200ms)
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result.errors).toBeDefined();
  });

  it("retries on network errors", async () => {
    let callCount = 0;
    const inner = makeClient(async () => {
      callCount += 1;
      if (callCount === 1) throw new TypeError("fetch failed");
      return okResponse({ ok: true });
    });

    const client = createRateLimitedClient(inner, {
      baseDelayMs: 100,
    });

    const promise = client.request("query");
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result.data).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });

  it("throws after exhausting network retries", async () => {
    const inner = makeClient(async () => {
      throw new TypeError("fetch failed");
    });

    const client = createRateLimitedClient(inner, {
      networkRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 400,
    });

    const promise = client.request("query").catch((e: unknown) => e);

    // Advance enough for: retry 1 (100ms) + retry 2 (200ms)
    await vi.advanceTimersByTimeAsync(500);

    const error = await promise;
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe("fetch failed");
  });

  it("throws immediately on non-network errors", async () => {
    const inner = makeClient(async () => {
      throw new Error("Unexpected parsing error");
    });

    const client = createRateLimitedClient(inner);

    await expect(client.request("query")).rejects.toThrow(
      "Unexpected parsing error",
    );
  });

  it("proactively delays when available points are low", async () => {
    let callCount = 0;
    const inner = makeClient(async () => {
      callCount += 1;
      return okResponse(
        { ok: true },
        {
          cost: {
            throttleStatus: {
              maximumAvailable: 1000,
              currentlyAvailable: 10,
              restoreRate: 50,
            },
          },
        },
      );
    });

    const client = createRateLimitedClient(inner);
    const promise = client.request("query");

    // Should delay: ceil((50 - 10) / 50) * 1000 = 1000ms
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.data).toEqual({ ok: true });
    expect(callCount).toBe(1);
  });
});
