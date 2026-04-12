import type { ResourceType, ResourceRecord, StoreClient } from "./types";
import {
  QUERIES,
  BLOG_ARTICLES_QUERY,
  METAFIELD_OWNER_TYPES,
} from "./queries.server";
import { createHash } from "crypto";

const PAGE_SIZE = 250;

function contentHash(data: Record<string, unknown>): string {
  const sorted = JSON.stringify(data, Object.keys(data).sort());
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface ConnectionResult {
  nodes: Record<string, unknown>[];
  pageInfo: PageInfo;
}

async function paginateQuery(
  client: StoreClient,
  query: string,
  variables: Record<string, unknown>,
  connectionPath: string,
): Promise<Record<string, unknown>[]> {
  const allNodes: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const result = await client.request(query, {
      variables: { ...variables, first: PAGE_SIZE, after: cursor },
    });

    if (result.errors) {
      console.error(
        `GraphQL error reading ${connectionPath}:`,
        result.errors,
      );
      throw new Error(`Failed to read ${connectionPath} from store`);
    }

    const connection = result.data?.[connectionPath] as
      | ConnectionResult
      | undefined;
    if (!connection) break;

    allNodes.push(...connection.nodes);
    hasNext = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  return allNodes;
}

function normalizeMetafieldDef(
  node: Record<string, unknown>,
): ResourceRecord {
  const ownerType = node.ownerType as string;
  const namespace = node.namespace as string;
  const key = node.key as string;
  const name = (node.name as string) ?? "";
  const description = (node.description as string) ?? "";
  const typeName = (node.type as { name: string })?.name ?? "";

  return {
    id: node.id as string,
    handle: `${ownerType}:${namespace}:${key}`,
    title: `${ownerType} — ${namespace}.${key}`,
    updatedAt: null,
    resourceType: "metafieldDefinitions",
    data: {
      ...node,
      _contentHash: contentHash({ description, name, typeName }),
    },
  };
}

function normalizeProduct(node: Record<string, unknown>): ResourceRecord {
  return {
    id: node.id as string,
    handle: node.handle as string,
    title: node.title as string,
    updatedAt: node.updatedAt as string,
    resourceType: "products",
    data: node,
  };
}

function normalizeCollection(node: Record<string, unknown>): ResourceRecord {
  return {
    id: node.id as string,
    handle: node.handle as string,
    title: node.title as string,
    updatedAt: node.updatedAt as string,
    resourceType: "collections",
    data: node,
  };
}

function normalizePage(node: Record<string, unknown>): ResourceRecord {
  return {
    id: node.id as string,
    handle: node.handle as string,
    title: node.title as string,
    updatedAt: node.updatedAt as string,
    resourceType: "pages",
    data: node,
  };
}

function normalizeMenu(node: Record<string, unknown>): ResourceRecord {
  const items = node.items as unknown[];
  return {
    id: node.id as string,
    handle: node.handle as string,
    title: node.title as string,
    updatedAt: null,
    resourceType: "menus",
    data: {
      ...node,
      _contentHash: contentHash({
        title: node.title as string,
        items: JSON.stringify(items),
      }),
    },
  };
}

function normalizeUrlRedirect(node: Record<string, unknown>): ResourceRecord {
  return {
    id: node.id as string,
    handle: node.path as string,
    title: `${node.path} → ${node.target}`,
    updatedAt: null,
    resourceType: "urlRedirects",
    data: {
      ...node,
      _contentHash: contentHash({ target: node.target as string }),
    },
  };
}

async function readMetafieldDefinitions(
  client: StoreClient,
): Promise<ResourceRecord[]> {
  const records: ResourceRecord[] = [];

  for (const ownerType of METAFIELD_OWNER_TYPES) {
    const nodes = await paginateQuery(
      client,
      QUERIES.metafieldDefinitions,
      { ownerType },
      "metafieldDefinitions",
    );

    for (const node of nodes) {
      const ns = node.namespace as string;
      if (ns.startsWith("$app:")) continue;
      records.push(normalizeMetafieldDef(node));
    }
  }

  return records;
}

async function readBlogs(client: StoreClient): Promise<ResourceRecord[]> {
  const records: ResourceRecord[] = [];
  const blogNodes = await paginateQuery(client, QUERIES.blogs, {}, "blogs");

  for (const blog of blogNodes) {
    const blogHandle = blog.handle as string;
    const blogId = blog.id as string;

    records.push({
      id: blogId,
      handle: blogHandle,
      title: blog.title as string,
      updatedAt: blog.updatedAt as string,
      resourceType: "blogs",
      data: blog,
    });

    // Blog articles are nested: { blog: { articles: { nodes, pageInfo } } }
    // paginateQuery expects a top-level connection, so we paginate manually
    const firstResult = await client.request(BLOG_ARTICLES_QUERY, {
      variables: { blogId, first: PAGE_SIZE, after: null },
    });

    const blogData = firstResult.data?.blog as Record<string, unknown> | undefined;
    const articlesConnection = blogData?.articles as ConnectionResult | undefined;
    if (!articlesConnection) continue;

    const allArticles = [...articlesConnection.nodes];
    let hasNext = articlesConnection.pageInfo.hasNextPage;
    let cursor = articlesConnection.pageInfo.endCursor;

    while (hasNext) {
      const nextResult = await client.request(BLOG_ARTICLES_QUERY, {
        variables: { blogId, first: PAGE_SIZE, after: cursor },
      });
      const nextBlog = nextResult.data?.blog as Record<string, unknown> | undefined;
      const nextArticles = nextBlog?.articles as ConnectionResult | undefined;
      if (!nextArticles) break;

      allArticles.push(...nextArticles.nodes);
      hasNext = nextArticles.pageInfo.hasNextPage;
      cursor = nextArticles.pageInfo.endCursor;
    }

    for (const article of allArticles) {
      records.push({
        id: article.id as string,
        handle: `${blogHandle}/${article.handle as string}`,
        title: article.title as string,
        updatedAt: article.updatedAt as string,
        resourceType: "blogs",
        data: { ...article, _blogHandle: blogHandle, _blogId: blogId },
      });
    }
  }

  return records;
}

const SIMPLE_READERS: Partial<
  Record<
    ResourceType,
    {
      connectionPath: string;
      normalize: (node: Record<string, unknown>) => ResourceRecord;
    }
  >
> = {
  products: { connectionPath: "products", normalize: normalizeProduct },
  collections: {
    connectionPath: "collections",
    normalize: normalizeCollection,
  },
  pages: { connectionPath: "pages", normalize: normalizePage },
  menus: { connectionPath: "menus", normalize: normalizeMenu },
  urlRedirects: {
    connectionPath: "urlRedirects",
    normalize: normalizeUrlRedirect,
  },
};

export async function readResources(
  client: StoreClient,
  resourceTypes: ResourceType[],
): Promise<Map<ResourceType, ResourceRecord[]>> {
  const results = new Map<ResourceType, ResourceRecord[]>();

  for (const type of resourceTypes) {
    if (type === "metafieldDefinitions") {
      results.set(type, await readMetafieldDefinitions(client));
      continue;
    }

    if (type === "blogs") {
      results.set(type, await readBlogs(client));
      continue;
    }

    const reader = SIMPLE_READERS[type];
    if (!reader) continue;

    const nodes = await paginateQuery(
      client,
      QUERIES[type],
      {},
      reader.connectionPath,
    );
    results.set(type, nodes.map(reader.normalize));
  }

  return results;
}
