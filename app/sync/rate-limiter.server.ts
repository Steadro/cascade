import type { StoreClient } from "./types";

interface ThrottleStatus {
  readonly maximumAvailable: number;
  readonly currentlyAvailable: number;
  readonly restoreRate: number;
}

interface RateLimitedClientOptions {
  readonly maxRetries?: number;
  readonly networkRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

const DEFAULTS = {
  maxRetries: 5,
  networkRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 16000,
} as const;

function extractThrottleStatus(
  extensions: Record<string, unknown> | undefined,
): ThrottleStatus | null {
  if (!extensions) return null;
  const cost = extensions.cost as Record<string, unknown> | undefined;
  if (!cost) return null;
  const status = cost.throttleStatus as ThrottleStatus | undefined;
  return status ?? null;
}

function isThrottledError(errors: unknown): boolean {
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    const msg = typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : "";
    return msg.includes("Throttled") || msg.includes("THROTTLED");
  });
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("timeout") ||
      msg.includes("socket")
    );
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRateLimitedClient(
  client: StoreClient,
  options?: RateLimitedClientOptions,
): StoreClient {
  const maxRetries = options?.maxRetries ?? DEFAULTS.maxRetries;
  const networkRetries = options?.networkRetries ?? DEFAULTS.networkRetries;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULTS.maxDelayMs;

  return {
    request: async (query, requestOptions) => {
      let throttleRetries = 0;
      let networkRetryCount = 0;
      let shouldRetry = true;

      while (shouldRetry) {
        shouldRetry = false;
        try {
          const response = await client.request(query, requestOptions);

          const throttle = extractThrottleStatus(response.extensions);

          if (throttle && throttle.currentlyAvailable < 50) {
            const waitMs = Math.min(
              Math.ceil((50 - throttle.currentlyAvailable) / throttle.restoreRate) * 1000,
              maxDelayMs,
            );
            await delay(waitMs);
          }

          if (isThrottledError(response.errors)) {
            throttleRetries += 1;
            if (throttleRetries > maxRetries) {
              return response;
            }
            const backoff = Math.min(
              baseDelayMs * Math.pow(2, throttleRetries - 1),
              maxDelayMs,
            );
            await delay(backoff);
            shouldRetry = true;
            continue;
          }

          return response;
        } catch (error) {
          if (isNetworkError(error)) {
            networkRetryCount += 1;
            if (networkRetryCount > networkRetries) {
              throw error;
            }
            const backoff = Math.min(
              baseDelayMs * Math.pow(2, networkRetryCount - 1),
              maxDelayMs,
            );
            await delay(backoff);
            shouldRetry = true;
            continue;
          }
          throw error;
        }
      }

      throw new Error("Rate limiter exhausted all retries without a response");
    },
  };
}
