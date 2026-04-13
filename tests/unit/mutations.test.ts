import { describe, it, expect } from "vitest";
import {
  buildMetafieldDefinitionMutation,
  buildProductMutation,
  buildCollectionMutation,
  buildPageMutation,
  buildBlogMutation,
  buildMenuMutation,
  buildUrlRedirectMutation,
  buildPublishMutation,
} from "../../app/sync/mutations.server";
import type { DiffItem, ResourceRecord } from "../../app/sync/types";

// ---------------------------------------------------------------------------
// Mock IdRemapper
// ---------------------------------------------------------------------------

function mockRemapper(
  mappings: Record<string, string> = {},
): { getTargetId: (id: string) => string | null; getTargetIdByHandle: (h: string, t: string) => string | null } {
  return {
    getTargetId: (id: string) => mappings[id] ?? null,
    getTargetIdByHandle: () => null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  overrides: Partial<ResourceRecord> & { data: Record<string, unknown> },
): ResourceRecord {
  return {
    id: overrides.id ?? "gid://shopify/Product/1",
    handle: overrides.handle ?? "test-handle",
    title: overrides.title ?? "Test",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
    resourceType: overrides.resourceType ?? "products",
    data: overrides.data,
  };
}

function makeDiffItem(
  action: "create" | "update",
  sourceData: Record<string, unknown>,
  targetRecord?: ResourceRecord | null,
): DiffItem {
  return {
    handle: (sourceData.handle as string) ?? "test",
    title: (sourceData.title as string) ?? "Test",
    action,
    reason: "test",
    sourceRecord: makeRecord({ data: sourceData }),
    targetRecord: targetRecord ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildMetafieldDefinitionMutation", () => {
  it("builds create mutation for custom metafield definition", () => {
    const item = makeDiffItem("create", {
      namespace: "custom",
      key: "color",
      name: "Color",
      description: "Product color",
      type: { name: "single_line_text_field" },
      ownerType: "PRODUCT",
    });

    const result = buildMetafieldDefinitionMutation(item);

    expect(result).not.toBeNull();
    const vars = result!.variables as { definition: Record<string, unknown> };
    expect(vars.definition.namespace).toBe("custom");
    expect(vars.definition.key).toBe("color");
    expect(vars.definition.type).toBe("single_line_text_field");
    expect(vars.definition.ownerType).toBe("PRODUCT");
  });

  it("returns null for update action", () => {
    const item = makeDiffItem("update", {
      namespace: "custom",
      key: "color",
      name: "Color",
      description: "",
      type: { name: "single_line_text_field" },
      ownerType: "PRODUCT",
    });

    expect(buildMetafieldDefinitionMutation(item)).toBeNull();
  });

  it("returns null for $app: namespaced definitions", () => {
    const item = makeDiffItem("create", {
      namespace: "$app:my-app",
      key: "secret",
      name: "Secret",
      description: "",
      type: { name: "json" },
      ownerType: "PRODUCT",
    });

    expect(buildMetafieldDefinitionMutation(item)).toBeNull();
  });
});

describe("buildProductMutation", () => {
  const productData = {
    id: "gid://shopify/Product/1",
    handle: "widget",
    title: "Widget",
    status: "ACTIVE",
    options: [{ name: "Size", values: ["S", "M", "L"] }],
    variants: {
      nodes: [
        { id: "gid://shopify/ProductVariant/10", title: "S", sku: "W-S", price: "19.99", inventoryQuantity: 5 },
        { id: "gid://shopify/ProductVariant/11", title: "M", sku: "W-M", price: "19.99", inventoryQuantity: 3 },
      ],
    },
    metafields: { nodes: [] },
  };

  it("builds create mutation with all variants", () => {
    const item = makeDiffItem("create", productData);
    const result = buildProductMutation(item, mockRemapper() as any);

    expect(result.mutation).toContain("productSet");
    const vars = result.variables as { input: Record<string, unknown>; synchronous: boolean };
    expect(vars.synchronous).toBe(true);
    expect((vars.input.variants as unknown[]).length).toBe(2);
    expect(vars.input.title).toBe("Widget");
    expect(vars.input.status).toBe("ACTIVE");
  });

  it("builds update mutation with target identifier and remapped variant IDs", () => {
    const target = makeRecord({
      id: "gid://shopify/Product/100",
      data: {},
    });
    const item = makeDiffItem("update", productData, target);
    const remapper = mockRemapper({
      "gid://shopify/ProductVariant/10": "gid://shopify/ProductVariant/110",
      "gid://shopify/ProductVariant/11": "gid://shopify/ProductVariant/111",
    });

    const result = buildProductMutation(item, remapper as any);
    const vars = result.variables as Record<string, unknown>;

    expect(vars.identifier).toEqual({ id: "gid://shopify/Product/100" });
    const variants = (vars.input as Record<string, unknown>).variants as Array<Record<string, unknown>>;
    expect(variants[0].id).toBe("gid://shopify/ProductVariant/110");
    expect(variants[1].id).toBe("gid://shopify/ProductVariant/111");
  });

  it("filters out $app: namespaced metafields", () => {
    const dataWithMeta = {
      ...productData,
      metafields: {
        nodes: [
          { namespace: "custom", key: "color", value: "red", type: "single_line_text_field" },
          { namespace: "$app:my-app", key: "secret", value: "{}", type: "json" },
        ],
      },
    };
    const item = makeDiffItem("create", dataWithMeta);
    const result = buildProductMutation(item, mockRemapper() as any);
    const vars = result.variables as { input: Record<string, unknown> };
    const metas = vars.input.metafields as Array<Record<string, unknown>>;
    expect(metas).toHaveLength(1);
    expect(metas[0].namespace).toBe("custom");
  });
});

describe("buildCollectionMutation", () => {
  it("builds create mutation for smart collection with rules", () => {
    const item = makeDiffItem("create", {
      title: "Summer",
      handle: "summer",
      sortOrder: "BEST_SELLING",
      templateSuffix: null,
      ruleSet: {
        appliedDisjunctively: false,
        rules: [{ column: "TAG", relation: "EQUALS", condition: "summer" }],
      },
      image: null,
    });

    const result = buildCollectionMutation(item);

    expect(result.mutation).toContain("collectionCreate");
    const vars = result.variables as { input: Record<string, unknown> };
    expect(vars.input.ruleSet).toBeDefined();
    expect((vars.input.ruleSet as Record<string, unknown>).appliedDisjunctively).toBe(false);
  });

  it("builds update mutation with target ID", () => {
    const target = makeRecord({ id: "gid://shopify/Collection/200", data: {} });
    const item = makeDiffItem("update", {
      title: "Winter",
      handle: "winter",
      sortOrder: "MANUAL",
      templateSuffix: null,
      ruleSet: null,
    }, target);

    const result = buildCollectionMutation(item);

    expect(result.mutation).toContain("collectionUpdate");
    const vars = result.variables as { input: Record<string, unknown> };
    expect(vars.input.id).toBe("gid://shopify/Collection/200");
  });
});

describe("buildPageMutation", () => {
  it("builds create mutation with body", () => {
    const item = makeDiffItem("create", {
      title: "About",
      handle: "about",
      body: "<p>About us</p>",
      isPublished: true,
      templateSuffix: null,
    });

    const result = buildPageMutation(item);

    expect(result.mutation).toContain("pageCreate");
    const vars = result.variables as { page: Record<string, unknown> };
    expect(vars.page.body).toBe("<p>About us</p>");
  });

  it("uses bodyOverride when provided", () => {
    const item = makeDiffItem("create", {
      title: "About",
      handle: "about",
      body: "<p>Original CDN URL</p>",
      isPublished: true,
      templateSuffix: null,
    });

    const result = buildPageMutation(item, "<p>Rewritten URL</p>");
    const vars = result.variables as { page: Record<string, unknown> };
    expect(vars.page.body).toBe("<p>Rewritten URL</p>");
  });

  it("builds update mutation with target ID", () => {
    const target = makeRecord({ id: "gid://shopify/Page/300", data: {} });
    const item = makeDiffItem("update", {
      title: "About",
      handle: "about",
      body: "<p>Updated</p>",
      isPublished: true,
      templateSuffix: null,
    }, target);

    const result = buildPageMutation(item);

    expect(result.mutation).toContain("pageUpdate");
    const vars = result.variables as { id: string };
    expect(vars.id).toBe("gid://shopify/Page/300");
  });
});

describe("buildBlogMutation", () => {
  it("builds blog create mutation", () => {
    const item = makeDiffItem("create", {
      id: "gid://shopify/Blog/1",
      handle: "news",
      title: "News",
    });

    const result = buildBlogMutation(item, mockRemapper() as any);

    expect(result).not.toBeNull();
    expect(result!.mutation).toContain("blogCreate");
    const vars = result!.variables as { blog: Record<string, unknown> };
    expect(vars.blog.title).toBe("News");
  });

  it("returns null for blog update (blogs are create-only for now)", () => {
    const target = makeRecord({ id: "gid://shopify/Blog/100", data: {} });
    const item = makeDiffItem("update", {
      id: "gid://shopify/Blog/1",
      handle: "news",
      title: "News",
    }, target);

    expect(buildBlogMutation(item, mockRemapper() as any)).toBeNull();
  });

  it("builds article create mutation with remapped blog ID", () => {
    const remapper = mockRemapper({
      "gid://shopify/Blog/1": "gid://shopify/Blog/100",
    });

    const item = makeDiffItem("create", {
      id: "gid://shopify/Article/10",
      handle: "hello-world",
      title: "Hello World",
      body: "<p>Content</p>",
      isPublished: true,
      tags: ["intro"],
      image: null,
      _blogHandle: "news",
      _blogId: "gid://shopify/Blog/1",
    });

    const result = buildBlogMutation(item, remapper as any);

    expect(result).not.toBeNull();
    expect(result!.mutation).toContain("articleCreate");
    const vars = result!.variables as { article: Record<string, unknown> };
    expect(vars.article.blogId).toBe("gid://shopify/Blog/100");
    expect(vars.article.body).toBe("<p>Content</p>");
  });

  it("returns null when blog ID is unmapped", () => {
    const item = makeDiffItem("create", {
      _blogHandle: "news",
      _blogId: "gid://shopify/Blog/999",
      body: "<p>Content</p>",
      isPublished: true,
      tags: [],
    });

    expect(buildBlogMutation(item, mockRemapper() as any)).toBeNull();
  });

  it("uses bodyOverride for articles", () => {
    const remapper = mockRemapper({
      "gid://shopify/Blog/1": "gid://shopify/Blog/100",
    });

    const item = makeDiffItem("create", {
      _blogHandle: "news",
      _blogId: "gid://shopify/Blog/1",
      body: "<p>Original</p>",
      isPublished: true,
      tags: [],
      image: null,
    });

    const result = buildBlogMutation(item, remapper as any, "<p>Rewritten</p>");
    const vars = result!.variables as { article: Record<string, unknown> };
    expect(vars.article.body).toBe("<p>Rewritten</p>");
  });

  it("includes image in article mutation", () => {
    const remapper = mockRemapper({
      "gid://shopify/Blog/1": "gid://shopify/Blog/100",
    });

    const item = makeDiffItem("create", {
      _blogHandle: "news",
      _blogId: "gid://shopify/Blog/1",
      body: "",
      isPublished: true,
      tags: [],
      image: { url: "https://cdn.shopify.com/photo.jpg", altText: "Photo" },
    });

    const result = buildBlogMutation(item, remapper as any);
    const vars = result!.variables as { article: Record<string, unknown> };
    expect(vars.article.image).toEqual({
      src: "https://cdn.shopify.com/photo.jpg",
      altText: "Photo",
    });
  });
});

describe("buildMenuMutation", () => {
  const menuData = {
    title: "Main Menu",
    handle: "main-menu",
    items: [
      {
        id: "gid://shopify/MenuItem/1",
        title: "Products",
        type: "COLLECTION",
        url: "/collections/all",
        resourceId: "gid://shopify/Collection/10",
        items: [
          {
            id: "gid://shopify/MenuItem/2",
            title: "Featured",
            type: "COLLECTION",
            url: "/collections/featured",
            resourceId: "gid://shopify/Collection/11",
            items: [],
          },
        ],
      },
      {
        id: "gid://shopify/MenuItem/3",
        title: "About",
        type: "HTTP",
        url: "/pages/about",
        resourceId: null,
        items: [],
      },
    ],
  };

  it("builds create mutation with remapped resource IDs", () => {
    const remapper = mockRemapper({
      "gid://shopify/Collection/10": "gid://shopify/Collection/110",
      "gid://shopify/Collection/11": "gid://shopify/Collection/111",
    });

    const item = makeDiffItem("create", menuData);
    const result = buildMenuMutation(item, remapper as any);

    expect(result.mutation).toContain("menuCreate");
    const vars = result.variables as { menu: Record<string, unknown> };
    expect(vars.menu.title).toBe("Main Menu");
  });

  it("skips items with unmapped resource IDs", () => {
    const remapper = mockRemapper({});

    const item = makeDiffItem("create", menuData);
    const result = buildMenuMutation(item, remapper as any);

    const vars = result.variables as { menu: { items: Array<Record<string, unknown>> } };
    // Only "About" item (no resourceId) should remain
    expect(vars.menu.items).toHaveLength(1);
    expect(vars.menu.items[0].title).toBe("About");
  });

  it("builds update mutation with target ID", () => {
    const remapper = mockRemapper({
      "gid://shopify/Collection/10": "gid://shopify/Collection/110",
      "gid://shopify/Collection/11": "gid://shopify/Collection/111",
    });

    const target = makeRecord({ id: "gid://shopify/Menu/500", data: {} });
    const item = makeDiffItem("update", menuData, target);
    const result = buildMenuMutation(item, remapper as any);

    expect(result.mutation).toContain("menuUpdate");
    const vars = result.variables as { id: string };
    expect(vars.id).toBe("gid://shopify/Menu/500");
  });
});

describe("buildUrlRedirectMutation", () => {
  it("builds create mutation with path and target", () => {
    const item = makeDiffItem("create", {
      path: "/old-page",
      target: "/new-page",
    });

    const result = buildUrlRedirectMutation(item);

    expect(result).not.toBeNull();
    expect(result!.mutation).toContain("urlRedirectCreate");
    const vars = result!.variables as { urlRedirect: Record<string, unknown> };
    expect(vars.urlRedirect.path).toBe("/old-page");
    expect(vars.urlRedirect.target).toBe("/new-page");
  });

  it("returns null for update action", () => {
    const item = makeDiffItem("update", { path: "/old", target: "/new" });
    expect(buildUrlRedirectMutation(item)).toBeNull();
  });
});

describe("buildPublishMutation", () => {
  it("builds publish mutation with resource and publication IDs", () => {
    const result = buildPublishMutation(
      "gid://shopify/Product/1",
      "gid://shopify/Publication/99",
    );

    expect(result.mutation).toContain("publishablePublish");
    const vars = result.variables as { id: string; input: Array<{ publicationId: string }> };
    expect(vars.id).toBe("gid://shopify/Product/1");
    expect(vars.input[0].publicationId).toBe("gid://shopify/Publication/99");
  });
});
