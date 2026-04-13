import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractCdnUrls,
  canonicalizeCdnUrl,
  inferContentType,
  uploadFileToTarget,
  rewriteCdnUrls,
} from "../../app/sync/cdn-rewriter.server";
import type { StoreClient, StoreClientResponse } from "../../app/sync/types";

function makeClient(
  handler: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<StoreClientResponse>,
): StoreClient {
  return { request: handler };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("extractCdnUrls", () => {
  it("extracts a single CDN URL from HTML", () => {
    const html = '<img src="https://cdn.shopify.com/s/files/1/0001/2345/files/photo.jpg">';
    expect(extractCdnUrls(html)).toEqual([
      "https://cdn.shopify.com/s/files/1/0001/2345/files/photo.jpg",
    ]);
  });

  it("extracts multiple unique CDN URLs", () => {
    const html = `
      <img src="https://cdn.shopify.com/s/files/1/0001/2345/files/a.jpg">
      <img src="https://cdn.shopify.com/s/files/1/0001/2345/files/b.png">
    `;
    const urls = extractCdnUrls(html);
    expect(urls).toHaveLength(2);
    expect(urls).toContain("https://cdn.shopify.com/s/files/1/0001/2345/files/a.jpg");
    expect(urls).toContain("https://cdn.shopify.com/s/files/1/0001/2345/files/b.png");
  });

  it("deduplicates identical URLs", () => {
    const html = `
      <img src="https://cdn.shopify.com/s/files/1/0001/2345/files/a.jpg">
      <img src="https://cdn.shopify.com/s/files/1/0001/2345/files/a.jpg">
    `;
    expect(extractCdnUrls(html)).toHaveLength(1);
  });

  it("handles URLs with query parameters", () => {
    const html = '<img src="https://cdn.shopify.com/s/files/1/0001/2345/files/photo.jpg?v=123&width=300">';
    expect(extractCdnUrls(html)).toEqual([
      "https://cdn.shopify.com/s/files/1/0001/2345/files/photo.jpg?v=123&width=300",
    ]);
  });

  it("returns empty array for HTML with no CDN URLs", () => {
    const html = '<img src="https://example.com/photo.jpg">';
    expect(extractCdnUrls(html)).toEqual([]);
  });

  it("does not match non-cdn.shopify.com URLs", () => {
    const html = '<img src="https://other.shopify.com/s/files/1/photo.jpg">';
    expect(extractCdnUrls(html)).toEqual([]);
  });

  it("matches protocol-relative URLs", () => {
    const html = '<img src="//cdn.shopify.com/s/files/1/0001/2345/files/photo.jpg">';
    expect(extractCdnUrls(html)).toEqual([
      "//cdn.shopify.com/s/files/1/0001/2345/files/photo.jpg",
    ]);
  });

  it("handles URLs in href and background-image contexts", () => {
    const html = `
      <a href="https://cdn.shopify.com/s/files/1/0001/2345/files/doc.pdf">Download</a>
      <div style="background-image: url('https://cdn.shopify.com/s/files/1/0001/2345/files/bg.jpg')">
    `;
    const urls = extractCdnUrls(html);
    expect(urls).toHaveLength(2);
  });
});

describe("canonicalizeCdnUrl", () => {
  it("strips query string", () => {
    expect(canonicalizeCdnUrl("https://cdn.shopify.com/s/files/1/photo.jpg?v=123")).toBe(
      "https://cdn.shopify.com/s/files/1/photo.jpg",
    );
  });

  it("returns URL unchanged if no query string", () => {
    const url = "https://cdn.shopify.com/s/files/1/photo.jpg";
    expect(canonicalizeCdnUrl(url)).toBe(url);
  });
});

describe("inferContentType", () => {
  it.each([
    ["photo.jpg", "IMAGE"],
    ["photo.jpeg", "IMAGE"],
    ["photo.png", "IMAGE"],
    ["photo.gif", "IMAGE"],
    ["photo.webp", "IMAGE"],
    ["icon.svg", "IMAGE"],
    ["photo.avif", "IMAGE"],
  ] as const)("returns IMAGE for %s", (filename, expected) => {
    expect(inferContentType(`https://cdn.shopify.com/s/files/1/${filename}`)).toBe(expected);
  });

  it.each([
    ["doc.pdf", "FILE"],
    ["data.csv", "FILE"],
    ["archive.zip", "FILE"],
  ] as const)("returns FILE for %s", (filename, expected) => {
    expect(inferContentType(`https://cdn.shopify.com/s/files/1/${filename}`)).toBe(expected);
  });
});

describe("uploadFileToTarget", () => {
  it("uploads file and returns target URL after READY status", async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          data: {
            fileCreate: {
              files: [{
                id: "gid://shopify/MediaImage/123",
                fileStatus: "PROCESSING",
                image: null,
              }],
              userErrors: [],
            },
          },
        };
      }
      if (callCount === 2) {
        return {
          data: {
            node: { fileStatus: "PROCESSING", image: null },
          },
        };
      }
      return {
        data: {
          node: {
            fileStatus: "READY",
            image: { url: "https://cdn.shopify.com/s/files/1/target/photo.jpg" },
          },
        },
      };
    });

    const promise = uploadFileToTarget(
      "https://cdn.shopify.com/s/files/1/source/photo.jpg",
      client,
    );

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toBe("https://cdn.shopify.com/s/files/1/target/photo.jpg");
    expect(callCount).toBe(3);
  });

  it("returns null when fileCreate returns userErrors", async () => {
    const client = makeClient(async () => ({
      data: {
        fileCreate: {
          files: [],
          userErrors: [{ field: ["files"], message: "Invalid source" }],
        },
      },
    }));

    const result = await uploadFileToTarget("https://cdn.shopify.com/s/files/1/bad.jpg", client);
    expect(result).toBeNull();
  });

  it("returns null when polling times out", async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          data: {
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/123", fileStatus: "PROCESSING" }],
              userErrors: [],
            },
          },
        };
      }
      return { data: { node: { fileStatus: "PROCESSING", image: null } } };
    });

    const promise = uploadFileToTarget("https://cdn.shopify.com/s/files/1/slow.jpg", client);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    const result = await promise;
    expect(result).toBeNull();
  });

  it("returns null when file status is FAILED", async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          data: {
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/123", fileStatus: "PROCESSING" }],
              userErrors: [],
            },
          },
        };
      }
      return { data: { node: { fileStatus: "FAILED" } } };
    });

    const promise = uploadFileToTarget("https://cdn.shopify.com/s/files/1/bad.jpg", client);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toBeNull();
  });

  it("handles GenericFile response shape", async () => {
    const client = makeClient(async () => ({
      data: {
        fileCreate: {
          files: [{
            id: "gid://shopify/GenericFile/456",
            fileStatus: "READY",
            url: "https://cdn.shopify.com/s/files/1/target/doc.pdf",
          }],
          userErrors: [],
        },
      },
    }));

    const result = await uploadFileToTarget("https://cdn.shopify.com/s/files/1/source/doc.pdf", client);
    expect(result).toBe("https://cdn.shopify.com/s/files/1/target/doc.pdf");
  });

  it("returns URL immediately when fileCreate returns READY", async () => {
    const client = makeClient(async () => ({
      data: {
        fileCreate: {
          files: [{
            id: "gid://shopify/MediaImage/789",
            fileStatus: "READY",
            image: { url: "https://cdn.shopify.com/s/files/1/target/instant.jpg" },
          }],
          userErrors: [],
        },
      },
    }));

    const result = await uploadFileToTarget("https://cdn.shopify.com/s/files/1/source/instant.jpg", client);
    expect(result).toBe("https://cdn.shopify.com/s/files/1/target/instant.jpg");
  });
});

describe("rewriteCdnUrls", () => {
  it("rewrites all CDN URLs in HTML", async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount += 1;
      return {
        data: {
          fileCreate: {
            files: [{
              id: `gid://shopify/MediaImage/${callCount}`,
              fileStatus: "READY",
              image: { url: `https://cdn.shopify.com/s/files/1/target/img${callCount}.jpg` },
            }],
            userErrors: [],
          },
        },
      };
    });

    const html = `
      <img src="https://cdn.shopify.com/s/files/1/source/img1.jpg">
      <img src="https://cdn.shopify.com/s/files/1/source/img2.jpg">
    `;

    const result = await rewriteCdnUrls(html, client);

    expect(result.rewrittenCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.html).toContain("target/img1.jpg");
    expect(result.html).toContain("target/img2.jpg");
    expect(result.html).not.toContain("source/img1.jpg");
    expect(result.html).not.toContain("source/img2.jpg");
  });

  it("uses cache to avoid duplicate uploads", async () => {
    let uploadCalls = 0;
    const client = makeClient(async () => {
      uploadCalls += 1;
      return {
        data: {
          fileCreate: {
            files: [{
              id: "gid://shopify/MediaImage/1",
              fileStatus: "READY",
              image: { url: "https://cdn.shopify.com/s/files/1/target/photo.jpg" },
            }],
            userErrors: [],
          },
        },
      };
    });

    const cache = new Map<string, string>();
    const cacheAdapter: { get: (k: string) => string | undefined; set: (k: string, v: string) => void } = {
      get: (k) => cache.get(k),
      set: (k, v) => { cache.set(k, v); },
    };

    const html1 = '<img src="https://cdn.shopify.com/s/files/1/source/photo.jpg">';
    await rewriteCdnUrls(html1, client, cacheAdapter);
    expect(uploadCalls).toBe(1);

    const html2 = '<img src="https://cdn.shopify.com/s/files/1/source/photo.jpg">';
    const result = await rewriteCdnUrls(html2, client, cacheAdapter);
    expect(uploadCalls).toBe(1);
    expect(result.rewrittenCount).toBe(1);
  });

  it("keeps original URL when upload fails", async () => {
    const client = makeClient(async () => ({
      data: {
        fileCreate: {
          files: [],
          userErrors: [{ field: ["files"], message: "Failed" }],
        },
      },
    }));

    const originalUrl = "https://cdn.shopify.com/s/files/1/source/broken.jpg";
    const html = `<img src="${originalUrl}">`;

    const result = await rewriteCdnUrls(html, client);

    expect(result.html).toContain(originalUrl);
    expect(result.failedCount).toBe(1);
    expect(result.rewrittenCount).toBe(0);
    expect(result.failures[0].url).toBe(originalUrl);
  });

  it("handles HTML with no CDN URLs as no-op", async () => {
    const client = makeClient(async () => ({ data: {} }));
    const html = "<p>Hello world</p>";

    const result = await rewriteCdnUrls(html, client);

    expect(result.html).toBe(html);
    expect(result.rewrittenCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  it("pre-populated cache skips all uploads", async () => {
    let uploadCalls = 0;
    const client = makeClient(async () => {
      uploadCalls += 1;
      return { data: {} };
    });

    const cache = new Map<string, string>();
    cache.set(
      "https://cdn.shopify.com/s/files/1/source/cached.jpg",
      "https://cdn.shopify.com/s/files/1/target/cached.jpg",
    );

    const html = '<img src="https://cdn.shopify.com/s/files/1/source/cached.jpg">';
    const result = await rewriteCdnUrls(html, client, {
      get: (k) => cache.get(k),
      set: (k, v) => { cache.set(k, v); },
    });

    expect(uploadCalls).toBe(0);
    expect(result.rewrittenCount).toBe(1);
    expect(result.html).toContain("target/cached.jpg");
  });
});
