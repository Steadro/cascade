import type { ResourceRecord } from "./types";

export interface MatchResult {
  matched: Array<{ source: ResourceRecord; target: ResourceRecord }>;
  unmatchedSource: ResourceRecord[];
  unmatchedTarget: ResourceRecord[];
}

export function matchResources(
  sourceRecords: ResourceRecord[],
  targetRecords: ResourceRecord[],
): MatchResult {
  const targetByHandle = new Map<string, ResourceRecord>();
  for (const record of targetRecords) {
    targetByHandle.set(record.handle, record);
  }

  const matched: MatchResult["matched"] = [];
  const unmatchedSource: ResourceRecord[] = [];

  for (const source of sourceRecords) {
    const target = targetByHandle.get(source.handle);
    if (target) {
      matched.push({ source, target });
      targetByHandle.delete(source.handle);
    } else {
      unmatchedSource.push(source);
    }
  }

  const unmatchedTarget = Array.from(targetByHandle.values());

  return { matched, unmatchedSource, unmatchedTarget };
}
