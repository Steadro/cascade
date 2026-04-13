import type { StoreClient } from "./types";

export interface CdnRewriteResult {
  readonly html: string;
  readonly rewrittenCount: number;
  readonly failedCount: number;
  readonly failures: ReadonlyArray<{ url: string; error: string }>;
}

export interface CdnRewriteCache {
  get(url: string): string | undefined;
  set(url: string, targetUrl: string): void;
}

const CDN_URL_PATTERN =
  /(?:https?:)?\/\/cdn\.shopify\.com\/s\/files\/[^\s"'<>)]+/g;

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "heic",
]);

const FILE_CREATE_MUTATION = `#graphql
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        alt
        ... on MediaImage {
          image { url }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_STATUS_QUERY = `#graphql
  query FileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        fileStatus
        image { url }
      }
      ... on GenericFile {
        fileStatus
        url
      }
    }
  }
`;

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 10;

export function extractCdnUrls(html: string): string[] {
  const matches = html.match(CDN_URL_PATTERN);
  if (!matches) return [];
  return [...new Set(matches)];
}

export function canonicalizeCdnUrl(url: string): string {
  return url.split("?")[0];
}

export function inferContentType(url: string): "IMAGE" | "FILE" {
  const canonical = canonicalizeCdnUrl(url);
  const lastDot = canonical.lastIndexOf(".");
  if (lastDot === -1) return "FILE";
  const ext = canonical.slice(lastDot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? "IMAGE" : "FILE";
}

function normalizeUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFileUrl(
  node: Record<string, unknown> | null,
): string | null {
  if (!node) return null;

  const image = node.image as { url?: string } | undefined;
  if (image?.url) return image.url;

  if (typeof node.url === "string") return node.url;

  return null;
}

export async function uploadFileToTarget(
  sourceUrl: string,
  targetClient: StoreClient,
): Promise<string | null> {
  const normalized = normalizeUrl(sourceUrl);

  const createResponse = await targetClient.request(FILE_CREATE_MUTATION, {
    variables: {
      files: [
        {
          contentType: inferContentType(normalized),
          originalSource: normalized,
        },
      ],
    },
  });

  const fileCreate = createResponse.data?.fileCreate as {
    files?: Array<Record<string, unknown>>;
    userErrors?: Array<{ field?: string[]; message: string }>;
  } | undefined;

  if (fileCreate?.userErrors?.length) {
    return null;
  }

  const file = fileCreate?.files?.[0];
  if (!file?.id) return null;

  const fileId = file.id as string;

  if (file.fileStatus === "READY") {
    return extractFileUrl(file);
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await delay(POLL_INTERVAL_MS);

    const statusResponse = await targetClient.request(FILE_STATUS_QUERY, {
      variables: { id: fileId },
    });

    const node = statusResponse.data?.node as Record<string, unknown> | null;
    if (!node) continue;

    const status = node.fileStatus as string | undefined;

    if (status === "READY") {
      return extractFileUrl(node);
    }

    if (status === "FAILED") {
      return null;
    }
  }

  return null;
}

export async function rewriteCdnUrls(
  html: string,
  targetClient: StoreClient,
  cache?: CdnRewriteCache,
): Promise<CdnRewriteResult> {
  const urls = extractCdnUrls(html);

  if (urls.length === 0) {
    return { html, rewrittenCount: 0, failedCount: 0, failures: [] };
  }

  const urlMap = new Map<string, string>();
  const failures: Array<{ url: string; error: string }> = [];

  for (const url of urls) {
    const canonical = canonicalizeCdnUrl(url);

    const cached = cache?.get(canonical);
    if (cached) {
      urlMap.set(url, cached);
      continue;
    }

    try {
      const targetUrl = await uploadFileToTarget(url, targetClient);
      if (targetUrl) {
        urlMap.set(url, targetUrl);
        cache?.set(canonical, targetUrl);
      } else {
        failures.push({ url, error: "Upload returned no target URL" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      failures.push({ url, error: message });
    }
  }

  let rewritten = html;
  for (const [sourceUrl, targetUrl] of urlMap) {
    rewritten = rewritten.replaceAll(sourceUrl, targetUrl);
  }

  return {
    html: rewritten,
    rewrittenCount: urlMap.size,
    failedCount: failures.length,
    failures,
  };
}
