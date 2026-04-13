import db from "../db.server";

export interface IdMapping {
  readonly sourceId: string;
  readonly targetId: string;
  readonly resourceType: string;
  readonly handle: string | null;
}

const DEFAULT_FLUSH_THRESHOLD = 50;

export class IdRemapper {
  private readonly pairingId: string;
  private readonly primaryMap: Map<string, string>;
  private readonly handleMap: Map<string, string>;
  private readonly pendingWrites: IdMapping[];
  private readonly flushThreshold: number;

  constructor(
    pairingId: string,
    options?: { flushThreshold?: number },
  ) {
    this.pairingId = pairingId;
    this.primaryMap = new Map();
    this.handleMap = new Map();
    this.pendingWrites = [];
    this.flushThreshold = options?.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD;
  }

  async loadMappings(): Promise<number> {
    const rows = await db.resourceMap.findMany({
      where: { pairingId: this.pairingId },
      select: {
        sourceId: true,
        targetId: true,
        resourceType: true,
        handle: true,
      },
    });

    for (const row of rows) {
      this.primaryMap.set(row.sourceId, row.targetId);
      if (row.handle) {
        this.handleMap.set(
          `${row.resourceType}:${row.handle}`,
          row.targetId,
        );
      }
    }

    return rows.length;
  }

  getTargetId(sourceId: string): string | null {
    return this.primaryMap.get(sourceId) ?? null;
  }

  getTargetIdByHandle(
    handle: string,
    resourceType: string,
  ): string | null {
    return this.handleMap.get(`${resourceType}:${handle}`) ?? null;
  }

  async addMapping(
    sourceId: string,
    targetId: string,
    resourceType: string,
    handle?: string | null,
  ): Promise<void> {
    this.primaryMap.set(sourceId, targetId);
    if (handle) {
      this.handleMap.set(`${resourceType}:${handle}`, targetId);
    }

    this.pendingWrites.push({
      sourceId,
      targetId,
      resourceType,
      handle: handle ?? null,
    });

    if (this.pendingWrites.length >= this.flushThreshold) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.pendingWrites.length === 0) return;

    const batch = this.pendingWrites.splice(0, this.pendingWrites.length);

    await db.$transaction(
      batch.map((mapping) =>
        db.resourceMap.upsert({
          where: {
            pairingId_resourceType_sourceId: {
              pairingId: this.pairingId,
              resourceType: mapping.resourceType,
              sourceId: mapping.sourceId,
            },
          },
          update: {
            targetId: mapping.targetId,
            handle: mapping.handle,
            lastSyncedAt: new Date(),
          },
          create: {
            pairingId: this.pairingId,
            sourceId: mapping.sourceId,
            targetId: mapping.targetId,
            resourceType: mapping.resourceType,
            handle: mapping.handle,
            lastSyncedAt: new Date(),
          },
        }),
      ),
    );
  }

  get size(): number {
    return this.primaryMap.size;
  }
}
