import { describe, it, expect } from "vitest";
import { matchResources } from "../../app/sync/matcher.server";
import type { ResourceRecord } from "../../app/sync/types";

function makeRecord(
  handle: string,
  overrides?: Partial<ResourceRecord>,
): ResourceRecord {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: handle,
    updatedAt: "2026-01-01T00:00:00Z",
    resourceType: "products",
    data: {},
    ...overrides,
  };
}

describe("matchResources", () => {
  it("matches records with identical handles", () => {
    const source = [makeRecord("widget")];
    const target = [makeRecord("widget")];

    const result = matchResources(source, target);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].source.handle).toBe("widget");
    expect(result.unmatchedSource).toHaveLength(0);
    expect(result.unmatchedTarget).toHaveLength(0);
  });

  it("classifies disjoint sets correctly", () => {
    const source = [makeRecord("a"), makeRecord("b")];
    const target = [makeRecord("c"), makeRecord("d")];

    const result = matchResources(source, target);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSource).toHaveLength(2);
    expect(result.unmatchedTarget).toHaveLength(2);
  });

  it("handles identical handle sets", () => {
    const source = [makeRecord("a"), makeRecord("b"), makeRecord("c")];
    const target = [makeRecord("a"), makeRecord("b"), makeRecord("c")];

    const result = matchResources(source, target);

    expect(result.matched).toHaveLength(3);
    expect(result.unmatchedSource).toHaveLength(0);
    expect(result.unmatchedTarget).toHaveLength(0);
  });

  it("handles partial overlap", () => {
    const source = [makeRecord("a"), makeRecord("b"), makeRecord("c")];
    const target = [makeRecord("b"), makeRecord("d")];

    const result = matchResources(source, target);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].source.handle).toBe("b");
    expect(result.unmatchedSource).toHaveLength(2);
    expect(result.unmatchedTarget).toHaveLength(1);
    expect(result.unmatchedTarget[0].handle).toBe("d");
  });

  it("returns all targets as unmatched when source is empty", () => {
    const result = matchResources([], [makeRecord("a"), makeRecord("b")]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSource).toHaveLength(0);
    expect(result.unmatchedTarget).toHaveLength(2);
  });

  it("returns all sources as unmatched when target is empty", () => {
    const result = matchResources([makeRecord("a"), makeRecord("b")], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSource).toHaveLength(2);
    expect(result.unmatchedTarget).toHaveLength(0);
  });

  it("returns empty arrays when both are empty", () => {
    const result = matchResources([], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSource).toHaveLength(0);
    expect(result.unmatchedTarget).toHaveLength(0);
  });

  it("matches composite metafield def handles", () => {
    const source = [
      makeRecord("PRODUCT:custom:color", {
        resourceType: "metafieldDefinitions",
      }),
    ];
    const target = [
      makeRecord("PRODUCT:custom:color", {
        resourceType: "metafieldDefinitions",
      }),
    ];

    const result = matchResources(source, target);
    expect(result.matched).toHaveLength(1);
  });

  it("matches composite blog/article handles", () => {
    const source = [
      makeRecord("news/first-post", { resourceType: "blogs" }),
    ];
    const target = [
      makeRecord("news/first-post", { resourceType: "blogs" }),
    ];

    const result = matchResources(source, target);
    expect(result.matched).toHaveLength(1);
  });

  it("preserves source and target identity in matched pairs", () => {
    const source = [
      makeRecord("widget", { id: "gid://shopify/Product/111" }),
    ];
    const target = [
      makeRecord("widget", { id: "gid://shopify/Product/222" }),
    ];

    const result = matchResources(source, target);

    expect(result.matched[0].source.id).toBe("gid://shopify/Product/111");
    expect(result.matched[0].target.id).toBe("gid://shopify/Product/222");
  });
});
