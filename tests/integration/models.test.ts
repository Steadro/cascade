import { describe, it, expect } from "vitest";
import { prisma } from "../setup";

describe("StorePairing", () => {
  it("creates a store pairing", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
        label: "Development",
      },
    });

    expect(pairing.id).toBeDefined();
    expect(pairing.primaryShop).toBe("prod.myshopify.com");
    expect(pairing.pairedShop).toBe("dev.myshopify.com");
    expect(pairing.label).toBe("Development");
    expect(pairing.status).toBe("active");
    expect(pairing.createdAt).toBeInstanceOf(Date);
  });

  it("reads a store pairing", async () => {
    const created = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const found = await prisma.storePairing.findUnique({
      where: { id: created.id },
    });

    expect(found).not.toBeNull();
    expect(found!.primaryShop).toBe("prod.myshopify.com");
  });

  it("updates a store pairing", async () => {
    const created = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
        status: "active",
      },
    });

    const updated = await prisma.storePairing.update({
      where: { id: created.id },
      data: { status: "disconnected", label: "QA" },
    });

    expect(updated.status).toBe("disconnected");
    expect(updated.label).toBe("QA");
  });

  it("deletes a store pairing", async () => {
    const created = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    await prisma.storePairing.delete({ where: { id: created.id } });

    const found = await prisma.storePairing.findUnique({
      where: { id: created.id },
    });
    expect(found).toBeNull();
  });

  it("enforces unique constraint on primaryShop + pairedShop", async () => {
    await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    await expect(
      prisma.storePairing.create({
        data: {
          primaryShop: "prod.myshopify.com",
          pairedShop: "dev.myshopify.com",
        },
      }),
    ).rejects.toThrow();
  });

  it("cascade deletes ResourceMap and SyncJob when pairing is deleted", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    await prisma.resourceMap.create({
      data: {
        pairingId: pairing.id,
        resourceType: "Product",
        sourceId: "gid://shopify/Product/1",
        targetId: "gid://shopify/Product/2",
        handle: "blue-widget",
      },
    });

    await prisma.syncJob.create({
      data: {
        pairingId: pairing.id,
        sourceShop: "prod.myshopify.com",
        targetShop: "dev.myshopify.com",
        resourceTypes: '["Product"]',
      },
    });

    await prisma.storePairing.delete({ where: { id: pairing.id } });

    const maps = await prisma.resourceMap.findMany({
      where: { pairingId: pairing.id },
    });
    const jobs = await prisma.syncJob.findMany({
      where: { pairingId: pairing.id },
    });

    expect(maps).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });
});

describe("ResourceMap", () => {
  it("creates a resource map entry", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const map = await prisma.resourceMap.create({
      data: {
        pairingId: pairing.id,
        resourceType: "Product",
        sourceId: "gid://shopify/Product/111",
        targetId: "gid://shopify/Product/222",
        handle: "red-widget",
      },
    });

    expect(map.id).toBeDefined();
    expect(map.resourceType).toBe("Product");
    expect(map.sourceId).toBe("gid://shopify/Product/111");
    expect(map.targetId).toBe("gid://shopify/Product/222");
    expect(map.handle).toBe("red-widget");
    expect(map.lastSyncedAt).toBeNull();
  });

  it("updates lastSyncedAt on resource map", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const map = await prisma.resourceMap.create({
      data: {
        pairingId: pairing.id,
        resourceType: "Page",
        sourceId: "gid://shopify/Page/1",
        targetId: "gid://shopify/Page/2",
      },
    });

    const now = new Date();
    const updated = await prisma.resourceMap.update({
      where: { id: map.id },
      data: { lastSyncedAt: now },
    });

    expect(updated.lastSyncedAt).toEqual(now);
  });

  it("enforces unique constraint on pairingId + resourceType + sourceId", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    await prisma.resourceMap.create({
      data: {
        pairingId: pairing.id,
        resourceType: "Product",
        sourceId: "gid://shopify/Product/1",
        targetId: "gid://shopify/Product/2",
      },
    });

    await expect(
      prisma.resourceMap.create({
        data: {
          pairingId: pairing.id,
          resourceType: "Product",
          sourceId: "gid://shopify/Product/1",
          targetId: "gid://shopify/Product/999",
        },
      }),
    ).rejects.toThrow();
  });

  it("allows same sourceId with different resourceType", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const map1 = await prisma.resourceMap.create({
      data: {
        pairingId: pairing.id,
        resourceType: "Product",
        sourceId: "gid://shopify/Product/1",
        targetId: "gid://shopify/Product/2",
      },
    });

    const map2 = await prisma.resourceMap.create({
      data: {
        pairingId: pairing.id,
        resourceType: "Collection",
        sourceId: "gid://shopify/Product/1",
        targetId: "gid://shopify/Collection/5",
      },
    });

    expect(map1.id).not.toBe(map2.id);
  });

  it("queries by pairingId and resourceType index", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    await prisma.resourceMap.createMany({
      data: [
        {
          pairingId: pairing.id,
          resourceType: "Product",
          sourceId: "gid://shopify/Product/1",
          targetId: "gid://shopify/Product/10",
        },
        {
          pairingId: pairing.id,
          resourceType: "Product",
          sourceId: "gid://shopify/Product/2",
          targetId: "gid://shopify/Product/20",
        },
        {
          pairingId: pairing.id,
          resourceType: "Collection",
          sourceId: "gid://shopify/Collection/1",
          targetId: "gid://shopify/Collection/10",
        },
      ],
    });

    const products = await prisma.resourceMap.findMany({
      where: { pairingId: pairing.id, resourceType: "Product" },
    });

    expect(products).toHaveLength(2);
  });
});

describe("SyncJob", () => {
  it("creates a sync job with defaults", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const job = await prisma.syncJob.create({
      data: {
        pairingId: pairing.id,
        sourceShop: "prod.myshopify.com",
        targetShop: "dev.myshopify.com",
        resourceTypes: '["Product","Collection"]',
      },
    });

    expect(job.status).toBe("pending");
    expect(job.progress).toBe(0);
    expect(job.totalItems).toBe(0);
    expect(job.processedItems).toBe(0);
    expect(job.errors).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(job.completedAt).toBeNull();
  });

  it("updates sync job progress", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const job = await prisma.syncJob.create({
      data: {
        pairingId: pairing.id,
        sourceShop: "prod.myshopify.com",
        targetShop: "dev.myshopify.com",
        resourceTypes: '["Product"]',
      },
    });

    const updated = await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        totalItems: 50,
        processedItems: 25,
        progress: 50,
        startedAt: new Date(),
      },
    });

    expect(updated.status).toBe("running");
    expect(updated.progress).toBe(50);
    expect(updated.processedItems).toBe(25);
    expect(updated.startedAt).toBeInstanceOf(Date);
  });

  it("stores errors as JSON string", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const errors = JSON.stringify([
      {
        resourceType: "Product",
        handle: "broken-widget",
        action: "create",
        error: "Title can't be blank",
      },
    ]);

    const job = await prisma.syncJob.create({
      data: {
        pairingId: pairing.id,
        sourceShop: "prod.myshopify.com",
        targetShop: "dev.myshopify.com",
        resourceTypes: '["Product"]',
        status: "failed",
        errors,
      },
    });

    const parsed = JSON.parse(job.errors!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].handle).toBe("broken-widget");
  });

  it("completes a sync job", async () => {
    const pairing = await prisma.storePairing.create({
      data: {
        primaryShop: "prod.myshopify.com",
        pairedShop: "dev.myshopify.com",
      },
    });

    const job = await prisma.syncJob.create({
      data: {
        pairingId: pairing.id,
        sourceShop: "prod.myshopify.com",
        targetShop: "dev.myshopify.com",
        resourceTypes: '["Product"]',
      },
    });

    const completed = await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        progress: 100,
        totalItems: 10,
        processedItems: 10,
        completedAt: new Date(),
      },
    });

    expect(completed.status).toBe("completed");
    expect(completed.progress).toBe(100);
    expect(completed.completedAt).toBeInstanceOf(Date);
  });
});
