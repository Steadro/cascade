import type { IdRemapper } from "./id-remapper.server";
import type { DiffItem } from "./types";

export interface MutationResult {
  readonly mutation: string;
  readonly variables: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// GraphQL mutation strings
// ---------------------------------------------------------------------------

const METAFIELD_DEFINITION_CREATE = `#graphql
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

const PRODUCT_SET = `#graphql
  mutation ProductSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(synchronous: $synchronous, input: $input) {
      product {
        id
        variants(first: 100) { nodes { id title } }
      }
      userErrors { field message code }
    }
  }
`;

const COLLECTION_CREATE = `#graphql
  mutation CollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

const COLLECTION_UPDATE = `#graphql
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

const PAGE_CREATE = `#graphql
  mutation PageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id }
      userErrors { field message code }
    }
  }
`;

const PAGE_UPDATE = `#graphql
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id }
      userErrors { field message code }
    }
  }
`;

const BLOG_CREATE = `#graphql
  mutation BlogCreate($blog: BlogInput!) {
    blogCreate(blog: $blog) {
      blog { id }
      userErrors { field message }
    }
  }
`;

const ARTICLE_CREATE = `#graphql
  mutation ArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id }
      userErrors { field message code }
    }
  }
`;

const ARTICLE_UPDATE = `#graphql
  mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id }
      userErrors { field message code }
    }
  }
`;

const MENU_CREATE = `#graphql
  mutation MenuCreate($menu: MenuInput!) {
    menuCreate(menu: $menu) {
      menu { id }
      userErrors { field message code }
    }
  }
`;

const MENU_UPDATE = `#graphql
  mutation MenuUpdate($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
      menu { id }
      userErrors { field message code }
    }
  }
`;

const URL_REDIRECT_CREATE = `#graphql
  mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect { id }
      userErrors { field message code }
    }
  }
`;

const PUBLISHABLE_PUBLISH = `#graphql
  mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { ... on Node { id } }
      userErrors { field message }
    }
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isArticle(data: Record<string, unknown>): boolean {
  return "_blogHandle" in data;
}

interface MenuItem {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly url: string | null;
  readonly resourceId: string | null;
  readonly items: MenuItem[];
}

function remapMenuItems(
  items: MenuItem[],
  remapper: IdRemapper,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const item of items) {
    let resourceId: string | null = null;
    if (item.resourceId) {
      const mapped = remapper.getTargetId(item.resourceId);
      if (!mapped) continue;
      resourceId = mapped;
    }

    const children = remapMenuItems(item.items ?? [], remapper);

    result.push({
      title: item.title,
      type: item.type,
      url: item.url,
      resourceId,
      items: children,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildMetafieldDefinitionMutation(
  item: DiffItem,
): MutationResult | null {
  if (item.action !== "create") return null;

  const data = item.sourceRecord.data;
  const namespace = data.namespace as string;

  if (namespace.startsWith("$app:")) return null;

  return {
    mutation: METAFIELD_DEFINITION_CREATE,
    variables: {
      definition: {
        name: data.name as string,
        namespace,
        key: data.key as string,
        description: (data.description as string) || undefined,
        type: (data.type as { name: string }).name,
        ownerType: data.ownerType as string,
      },
    },
  };
}

export function buildProductMutation(
  item: DiffItem,
  remapper: IdRemapper,
): MutationResult {
  const data = item.sourceRecord.data;
  const options = data.options as Array<{ name: string; values: string[] }>;
  const variants = (
    data.variants as { nodes: Array<Record<string, unknown>> }
  ).nodes;
  const metafields = (
    data.metafields as { nodes: Array<Record<string, unknown>> }
  ).nodes;

  const productOptions = options.map((opt, i) => ({
    name: opt.name,
    position: i + 1,
    values: opt.values.map((v) => ({ name: v })),
  }));

  const variantInputs = variants.map((v) => {
    const input: Record<string, unknown> = {
      optionValues: options.map((opt) => ({
        optionName: opt.name,
        name: v.title as string,
      })),
      price: parseFloat(v.price as string),
    };

    if (v.sku) {
      input.sku = v.sku as string;
    }

    if (item.action === "update" && v.id) {
      const targetVariantId = remapper.getTargetId(v.id as string);
      if (targetVariantId) {
        input.id = targetVariantId;
      }
    }

    return input;
  });

  const metafieldInputs = metafields
    .filter((m) => !(m.namespace as string).startsWith("$app:"))
    .map((m) => ({
      namespace: m.namespace as string,
      key: m.key as string,
      value: m.value as string,
      type: m.type as string,
    }));

  const productInput: Record<string, unknown> = {
    title: data.title as string,
    handle: data.handle as string,
    status: data.status as string,
    productOptions,
    variants: variantInputs,
  };

  if (metafieldInputs.length > 0) {
    productInput.metafields = metafieldInputs;
  }

  const variables: Record<string, unknown> = {
    synchronous: true,
    input: productInput,
  };

  if (item.action === "update" && item.targetRecord) {
    variables.identifier = { id: item.targetRecord.id };
  }

  return { mutation: PRODUCT_SET, variables };
}

export function buildCollectionMutation(
  item: DiffItem,
): MutationResult {
  const data = item.sourceRecord.data;

  const input: Record<string, unknown> = {
    title: data.title as string,
    handle: data.handle as string,
    sortOrder: data.sortOrder as string,
    templateSuffix: (data.templateSuffix as string) || undefined,
  };

  const ruleSet = data.ruleSet as {
    appliedDisjunctively: boolean;
    rules: Array<{ column: string; relation: string; condition: string }>;
  } | null;

  if (ruleSet) {
    input.ruleSet = {
      appliedDisjunctively: ruleSet.appliedDisjunctively,
      rules: ruleSet.rules.map((r) => ({
        column: r.column,
        relation: r.relation,
        condition: r.condition,
      })),
    };
  }

  if (item.action === "update" && item.targetRecord) {
    return {
      mutation: COLLECTION_UPDATE,
      variables: { input: { ...input, id: item.targetRecord.id } },
    };
  }

  return {
    mutation: COLLECTION_CREATE,
    variables: { input },
  };
}

export function buildPageMutation(
  item: DiffItem,
  bodyOverride?: string,
): MutationResult {
  const data = item.sourceRecord.data;
  const body = bodyOverride ?? (data.body as string);

  const page: Record<string, unknown> = {
    title: data.title as string,
    handle: data.handle as string,
    body,
    isPublished: data.isPublished as boolean,
    templateSuffix: (data.templateSuffix as string) || undefined,
  };

  if (item.action === "update" && item.targetRecord) {
    return {
      mutation: PAGE_UPDATE,
      variables: { id: item.targetRecord.id, page },
    };
  }

  return {
    mutation: PAGE_CREATE,
    variables: { page },
  };
}

export function buildBlogMutation(
  item: DiffItem,
  remapper: IdRemapper,
  bodyOverride?: string,
): MutationResult | null {
  const data = item.sourceRecord.data;

  if (!isArticle(data)) {
    if (item.action !== "create") return null;

    return {
      mutation: BLOG_CREATE,
      variables: {
        blog: { title: data.title as string, handle: data.handle as string },
      },
    };
  }

  const body = bodyOverride ?? (data.body as string);
  const sourceBlogId = data._blogId as string;
  const targetBlogId = remapper.getTargetId(sourceBlogId);

  if (!targetBlogId) return null;

  const articleInput: Record<string, unknown> = {
    title: data.title as string,
    handle: data.handle as string,
    body,
    isPublished: data.isPublished as boolean,
    tags: data.tags as string[],
    blogId: targetBlogId,
  };

  const image = data.image as { url: string; altText: string | null } | null;
  if (image) {
    articleInput.image = {
      src: image.url,
      altText: image.altText,
    };
  }

  if (item.action === "update" && item.targetRecord) {
    return {
      mutation: ARTICLE_UPDATE,
      variables: { id: item.targetRecord.id, article: articleInput },
    };
  }

  return {
    mutation: ARTICLE_CREATE,
    variables: { article: articleInput },
  };
}

export function buildMenuMutation(
  item: DiffItem,
  remapper: IdRemapper,
): MutationResult {
  const data = item.sourceRecord.data;
  const items = data.items as MenuItem[];
  const remappedItems = remapMenuItems(items, remapper);

  if (item.action === "update" && item.targetRecord) {
    return {
      mutation: MENU_UPDATE,
      variables: {
        id: item.targetRecord.id,
        title: data.title as string,
        handle: data.handle as string,
        items: remappedItems,
      },
    };
  }

  return {
    mutation: MENU_CREATE,
    variables: {
      menu: {
        title: data.title as string,
        handle: data.handle as string,
        items: remappedItems.map((i) => ({
          title: i.title,
          url: i.url,
          items: i.items,
        })),
      },
    },
  };
}

export function buildUrlRedirectMutation(
  item: DiffItem,
): MutationResult | null {
  if (item.action !== "create") return null;

  const data = item.sourceRecord.data;

  return {
    mutation: URL_REDIRECT_CREATE,
    variables: {
      urlRedirect: {
        path: data.path as string,
        target: data.target as string,
      },
    },
  };
}

export function buildPublishMutation(
  resourceId: string,
  publicationId: string,
): MutationResult {
  return {
    mutation: PUBLISHABLE_PUBLISH,
    variables: {
      id: resourceId,
      input: [{ publicationId }],
    },
  };
}
