-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorePairing" (
    "id" TEXT NOT NULL,
    "primaryShop" TEXT NOT NULL,
    "pairedShop" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceMap" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "handle" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "sourceShop" TEXT NOT NULL,
    "targetShop" TEXT NOT NULL,
    "resourceTypes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorePairing_primaryShop_pairedShop_key" ON "StorePairing"("primaryShop", "pairedShop");

-- CreateIndex
CREATE INDEX "ResourceMap_pairingId_resourceType_idx" ON "ResourceMap"("pairingId", "resourceType");

-- CreateIndex
CREATE INDEX "ResourceMap_pairingId_resourceType_handle_idx" ON "ResourceMap"("pairingId", "resourceType", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceMap_pairingId_resourceType_sourceId_key" ON "ResourceMap"("pairingId", "resourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "ResourceMap" ADD CONSTRAINT "ResourceMap_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "StorePairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "StorePairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
