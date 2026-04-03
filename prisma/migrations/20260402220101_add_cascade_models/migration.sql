-- CreateTable
CREATE TABLE "StorePairing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "primaryShop" TEXT NOT NULL,
    "pairedShop" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ResourceMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pairingId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "handle" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResourceMap_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "StorePairing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pairingId" TEXT NOT NULL,
    "sourceShop" TEXT NOT NULL,
    "targetShop" TEXT NOT NULL,
    "resourceTypes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncJob_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "StorePairing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StorePairing_primaryShop_pairedShop_key" ON "StorePairing"("primaryShop", "pairedShop");

-- CreateIndex
CREATE INDEX "ResourceMap_pairingId_resourceType_idx" ON "ResourceMap"("pairingId", "resourceType");

-- CreateIndex
CREATE INDEX "ResourceMap_pairingId_resourceType_handle_idx" ON "ResourceMap"("pairingId", "resourceType", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceMap_pairingId_resourceType_sourceId_key" ON "ResourceMap"("pairingId", "resourceType", "sourceId");
