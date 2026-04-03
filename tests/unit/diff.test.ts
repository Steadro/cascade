import { describe, it, expect } from "vitest";
import { diffResourceType } from "../../app/sync/diff.server";
import type { ResourceRecord } from "../../app/sync/types";
import type { MatchResult } from "../../app/sync/matcher.server";

function makeRecord(
  handle: string,
  updatedAt: string | null = "2026-01-01T00:00:00Z",
  data: Record<string, unknown> = {},
): ResourceRecord {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: handle,
    updatedAt,
    resourceType: "products",
    data,
  };
}

function emptyMatch(): MatchResult {
  return { matched: [], unmatchedSource: [], unmatchedTarget: [] };
}

describe("diffResourceType", () => {
  it("classifies unmatched source items as create", () => {
    const match: MatchResult = {
      ...emptyMatch(),
      unmatchedSource: [makeRecord("new-widget")],
    };

    const result = diffResourceType("products", match);

    expect(result.createCount).toBe(1);
    expect(result.items[0].action).toBe("create");
    expect(result.items[0].reason).toContain("Does not exist");
  });

  it("classifies matched with source newer as update", () => {
    const match: MatchResult = {
      ...emptyMatch(),
      matched: [
        {
          source: makeRecord("widget", "2026-03-01T00:00:00Z"),
          target: makeRecord("widget", "2026-01-01T00:00:00Z"),
        },
      ],
    };

    const result = diffResourceType("products", match);

    expect(result.updateCount).toBe(1);
    expect(result.items[0].action).toBe("update");
    expect(result.items[0].reason).toContain("newer");
  });

  it("classifies matched with identical timestamps as skip", () => {
    const ts = "2026-01-01T00:00:00Z";
    const match: MatchResult = {
      ...emptyMatch(),
      matched: [
        {
          source: makeRecord("widget", ts),
          target: makeRecord("widget", ts),
        },
      ],
    };

    const result = diffResourceType("products", match);

    expect(result.skipCount).toBe(1);
    expect(result.items[0].action).toBe("skip");
  });

  it("classifies matched with target newer as skip", () => {
    const match: MatchResult = {
      ...emptyMatch(),
      matched: [
        {
          source: makeRecord("widget", "2026-01-01T00:00:00Z"),
          target: makeRecord("widget", "2026-03-01T00:00:00Z"),
        },
      ],
    };

    const result = diffResourceType("products", match);

    expect(result.skipCount).toBe(1);
    expect(result.items[0].action).toBe("skip");
    expect(result.items[0].reason).toContain("up to date");
  });

  it("produces correct counts for mixed input", () => {
    const match: MatchResult = {
      unmatchedSource: [makeRecord("new-one")],
      unmatchedTarget: [makeRecord("orphan")],
      matched: [
        {
          source: makeRecord("updated", "2026-03-01T00:00:00Z"),
          target: makeRecord("updated", "2026-01-01T00:00:00Z"),
        },
        {
          source: makeRecord("same", "2026-01-01T00:00:00Z"),
          target: makeRecord("same", "2026-01-01T00:00:00Z"),
        },
      ],
    };

    const result = diffResourceType("products", match);

    expect(result.createCount).toBe(1);
    expect(result.updateCount).toBe(1);
    expect(result.skipCount).toBe(1);
    expect(result.items).toHaveLength(3); // unmatched target excluded
  });

  it("uses content hash for metafield definitions — different hash", () => {
    const match: MatchResult = {
      ...emptyMatch(),
      matched: [
        {
          source: makeRecord("PRODUCT:custom:color", null, {
            _contentHash: "abc123",
          }),
          target: makeRecord("PRODUCT:custom:color", null, {
            _contentHash: "def456",
          }),
        },
      ],
    };

    const result = diffResourceType("metafieldDefinitions", match);

    expect(result.updateCount).toBe(1);
    expect(result.items[0].action).toBe("update");
    expect(result.items[0].reason).toContain("Content differs");
  });

  it("uses content hash for metafield definitions — identical hash", () => {
    const match: MatchResult = {
      ...emptyMatch(),
      matched: [
        {
          source: makeRecord("PRODUCT:custom:color", null, {
            _contentHash: "same123",
          }),
          target: makeRecord("PRODUCT:custom:color", null, {
            _contentHash: "same123",
          }),
        },
      ],
    };

    const result = diffResourceType("metafieldDefinitions", match);

    expect(result.skipCount).toBe(1);
    expect(result.items[0].action).toBe("skip");
    expect(result.items[0].reason).toContain("identical");
  });

  it("counts match item array lengths", () => {
    const match: MatchResult = {
      unmatchedSource: [makeRecord("a"), makeRecord("b")],
      unmatchedTarget: [],
      matched: [
        {
          source: makeRecord("c", "2026-03-01T00:00:00Z"),
          target: makeRecord("c", "2026-01-01T00:00:00Z"),
        },
      ],
    };

    const result = diffResourceType("products", match);

    expect(result.createCount).toBe(2);
    expect(result.updateCount).toBe(1);
    expect(result.skipCount).toBe(0);
    expect(result.items).toHaveLength(3);
    expect(result.createCount + result.updateCount + result.skipCount).toBe(
      result.items.length,
    );
  });

  it("returns all-zero result for empty input", () => {
    const result = diffResourceType("products", emptyMatch());

    expect(result.createCount).toBe(0);
    expect(result.updateCount).toBe(0);
    expect(result.skipCount).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("handles all-creates scenario", () => {
    const match: MatchResult = {
      ...emptyMatch(),
      unmatchedSource: [makeRecord("a"), makeRecord("b"), makeRecord("c")],
    };

    const result = diffResourceType("products", match);

    expect(result.createCount).toBe(3);
    expect(result.updateCount).toBe(0);
    expect(result.skipCount).toBe(0);
  });

  it("handles all-skips scenario", () => {
    const ts = "2026-01-01T00:00:00Z";
    const match: MatchResult = {
      ...emptyMatch(),
      matched: [
        { source: makeRecord("a", ts), target: makeRecord("a", ts) },
        { source: makeRecord("b", ts), target: makeRecord("b", ts) },
      ],
    };

    const result = diffResourceType("products", match);

    expect(result.createCount).toBe(0);
    expect(result.updateCount).toBe(0);
    expect(result.skipCount).toBe(2);
  });

  it("sets correct label from RESOURCE_TYPE_LABELS", () => {
    const result = diffResourceType("menus", emptyMatch());
    expect(result.label).toBe("Navigation Menus");
  });
});
