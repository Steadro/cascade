export type ResourceType =
  | "metafieldDefinitions"
  | "products"
  | "collections"
  | "pages"
  | "blogs"
  | "menus"
  | "urlRedirects";

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  metafieldDefinitions: "Metafield Definitions",
  products: "Products",
  collections: "Collections",
  pages: "Pages",
  blogs: "Blogs & Articles",
  menus: "Navigation Menus",
  urlRedirects: "URL Redirects",
};

export const SYNC_ORDER: ResourceType[] = [
  "metafieldDefinitions",
  "products",
  "collections",
  "pages",
  "blogs",
  "menus",
  "urlRedirects",
];

export type SyncDirection = "push" | "pull";

export interface ResourceRecord {
  id: string;
  handle: string;
  title: string;
  updatedAt: string | null;
  resourceType: ResourceType;
  data: Record<string, unknown>;
}

export type DiffAction = "create" | "update" | "skip";

export interface DiffItem {
  handle: string;
  title: string;
  action: DiffAction;
  reason: string;
  sourceRecord: ResourceRecord;
  targetRecord: ResourceRecord | null;
}

export interface ResourceDiffResult {
  resourceType: ResourceType;
  label: string;
  createCount: number;
  updateCount: number;
  skipCount: number;
  items: DiffItem[];
}

export interface SyncPreview {
  sourceShop: string;
  targetShop: string;
  direction: SyncDirection;
  results: ResourceDiffResult[];
  totalCreate: number;
  totalUpdate: number;
  totalSkip: number;
  generatedAt: string;
}

export interface StoreClientResponse {
  readonly data?: Record<string, unknown>;
  readonly errors?: unknown;
  readonly extensions?: Record<string, unknown>;
}

export interface StoreClient {
  request: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<StoreClientResponse>;
}

export const TIMESTAMP_DIFF_TYPES: ResourceType[] = [
  "products",
  "collections",
  "pages",
  "blogs",
];

export const CONTENT_HASH_DIFF_TYPES: ResourceType[] = [
  "metafieldDefinitions",
  "menus",
  "urlRedirects",
];
