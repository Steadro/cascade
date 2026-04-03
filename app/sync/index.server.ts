import type {
  ResourceType,
  StoreClient,
  SyncDirection,
  SyncPreview,
} from "./types";
import { SYNC_ORDER } from "./types";
import { readResources } from "./reader.server";
import { matchResources } from "./matcher.server";
import { diffResourceType } from "./diff.server";

export { readResources } from "./reader.server";
export { matchResources } from "./matcher.server";
export { diffResourceType } from "./diff.server";

export async function generatePreview(
  sourceClient: StoreClient,
  targetClient: StoreClient,
  resourceTypes: ResourceType[],
  sourceShop: string,
  targetShop: string,
  direction: SyncDirection,
): Promise<SyncPreview> {
  const orderedTypes = SYNC_ORDER.filter((t) => resourceTypes.includes(t));

  const [sourceData, targetData] = await Promise.all([
    readResources(sourceClient, orderedTypes),
    readResources(targetClient, orderedTypes),
  ]);

  const results = orderedTypes.map((type) => {
    const sourceRecords = sourceData.get(type) ?? [];
    const targetRecords = targetData.get(type) ?? [];
    const matchResult = matchResources(sourceRecords, targetRecords);
    return diffResourceType(type, matchResult);
  });

  const totalCreate = results.reduce((sum, r) => sum + r.createCount, 0);
  const totalUpdate = results.reduce((sum, r) => sum + r.updateCount, 0);
  const totalSkip = results.reduce((sum, r) => sum + r.skipCount, 0);

  return {
    sourceShop,
    targetShop,
    direction,
    results,
    totalCreate,
    totalUpdate,
    totalSkip,
    generatedAt: new Date().toISOString(),
  };
}
