import type {
  ResourceType,
  ResourceRecord,
  DiffAction,
  DiffItem,
  ResourceDiffResult,
} from "./types";
import { RESOURCE_TYPE_LABELS, TIMESTAMP_DIFF_TYPES } from "./types";
import type { MatchResult } from "./matcher.server";

function determineAction(
  resourceType: ResourceType,
  source: ResourceRecord,
  target: ResourceRecord,
): { action: DiffAction; reason: string } {
  if (TIMESTAMP_DIFF_TYPES.includes(resourceType)) {
    const sourceDate = source.updatedAt ? new Date(source.updatedAt) : null;
    const targetDate = target.updatedAt ? new Date(target.updatedAt) : null;

    if (!sourceDate || !targetDate) {
      return { action: "skip", reason: "Missing timestamp — cannot compare" };
    }

    if (sourceDate.getTime() > targetDate.getTime()) {
      return { action: "update", reason: "Source is newer" };
    }

    return { action: "skip", reason: "Target is up to date" };
  }

  // Content hash comparison for metafieldDefinitions, menus, urlRedirects
  const sourceHash = source.data._contentHash as string | undefined;
  const targetHash = target.data._contentHash as string | undefined;

  if (sourceHash && targetHash && sourceHash !== targetHash) {
    return { action: "update", reason: "Content differs" };
  }

  if (sourceHash && targetHash && sourceHash === targetHash) {
    return { action: "skip", reason: "Content is identical" };
  }

  return { action: "skip", reason: "Unable to compare — skipping" };
}

export function diffResourceType(
  resourceType: ResourceType,
  matchResult: MatchResult,
): ResourceDiffResult {
  const items: DiffItem[] = [];

  for (const source of matchResult.unmatchedSource) {
    items.push({
      handle: source.handle,
      title: source.title,
      action: "create",
      reason: "Does not exist in target store",
      sourceRecord: source,
      targetRecord: null,
    });
  }

  for (const { source, target } of matchResult.matched) {
    const { action, reason } = determineAction(resourceType, source, target);
    items.push({
      handle: source.handle,
      title: source.title,
      action,
      reason,
      sourceRecord: source,
      targetRecord: target,
    });
  }

  const createCount = items.filter((i) => i.action === "create").length;
  const updateCount = items.filter((i) => i.action === "update").length;
  const skipCount = items.filter((i) => i.action === "skip").length;

  return {
    resourceType,
    label: RESOURCE_TYPE_LABELS[resourceType],
    createCount,
    updateCount,
    skipCount,
    items,
  };
}
