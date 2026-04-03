import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import path from "path";

const testDbUrl = `file:${path.join(__dirname, "..", "prisma", "test.sqlite")}`;

export const prisma = new PrismaClient({
  datasources: { db: { url: testDbUrl } },
});

beforeEach(async () => {
  await prisma.resourceMap.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.storePairing.deleteMany();
  await prisma.session.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
