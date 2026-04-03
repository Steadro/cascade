import type { ResourceType } from "./types";

export const METAFIELD_DEFINITIONS_QUERY = `#graphql
  query MetafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String) {
    metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after) {
      nodes {
        id
        namespace
        key
        name
        description
        type { name }
        ownerType
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        status
        updatedAt
        options { name values }
        variants(first: 100) {
          nodes { id title sku price inventoryQuantity }
        }
        metafields(first: 50) {
          nodes { namespace key value type }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const COLLECTIONS_QUERY = `#graphql
  query Collections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        updatedAt
        sortOrder
        templateSuffix
        ruleSet {
          appliedDisjunctively
          rules { column relation condition }
        }
        image { url altText }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PAGES_QUERY = `#graphql
  query Pages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        body
        updatedAt
        isPublished
        templateSuffix
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const BLOGS_QUERY = `#graphql
  query Blogs($first: Int!, $after: String) {
    blogs(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const BLOG_ARTICLES_QUERY = `#graphql
  query BlogArticles($blogId: ID!, $first: Int!, $after: String) {
    blog(id: $blogId) {
      articles(first: $first, after: $after) {
        nodes {
          id
          handle
          title
          body
          updatedAt
          isPublished
          tags
          image { url altText }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const MENUS_QUERY = `#graphql
  query Menus($first: Int!, $after: String) {
    menus(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        items {
          id title type url resourceId
          items {
            id title type url resourceId
            items {
              id title type url resourceId
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const URL_REDIRECTS_QUERY = `#graphql
  query UrlRedirects($first: Int!, $after: String) {
    urlRedirects(first: $first, after: $after) {
      nodes {
        id
        path
        target
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const QUERIES: Record<ResourceType, string> = {
  metafieldDefinitions: METAFIELD_DEFINITIONS_QUERY,
  products: PRODUCTS_QUERY,
  collections: COLLECTIONS_QUERY,
  pages: PAGES_QUERY,
  blogs: BLOGS_QUERY,
  menus: MENUS_QUERY,
  urlRedirects: URL_REDIRECTS_QUERY,
};

export const METAFIELD_OWNER_TYPES = [
  "PRODUCT",
  "COLLECTION",
  "PAGE",
  "ARTICLE",
  "BLOG",
] as const;
