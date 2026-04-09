import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, "..", ".env") });

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!testDbUrl) {
  throw new Error(
    "TEST_DATABASE_URL or DATABASE_URL must be set to run integration tests",
  );
}

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
