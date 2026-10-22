ALTER TABLE "AccessKey" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "AccessKey" ADD COLUMN "models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Lease"
  ADD COLUMN "fundingSource" TEXT NOT NULL DEFAULT 'WALLET',
  ADD COLUMN "upstreamModel" TEXT,
  ADD COLUMN "providerInputRate" INTEGER,
  ADD COLUMN "providerOutputRate" INTEGER,
  ADD COLUMN "providerSpent" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "MeterRequest" ADD COLUMN "providerCost" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Settlement"
  ADD COLUMN "providerAmount" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "providerCumulative" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "ModelProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "inputRate" INTEGER NOT NULL CHECK ("inputRate" > 0),
  "outputRate" INTEGER NOT NULL CHECK ("outputRate" > 0),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ModelRoute" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "modelId" TEXT NOT NULL REFERENCES "ModelProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "priority" INTEGER NOT NULL DEFAULT 100 CHECK ("priority" >= 0),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ModelRoute_modelId_listingId_key" ON "ModelRoute"("modelId", "listingId");
CREATE INDEX "ModelRoute_modelId_enabled_priority_idx" ON "ModelRoute"("modelId", "enabled", "priority");
CREATE TABLE "RoutedInvocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accessKeyId" TEXT NOT NULL REFERENCES "AccessKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "modelId" TEXT NOT NULL REFERENCES "ModelProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sessionId" TEXT NOT NULL REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RoutedInvocation_sessionId_key" ON "RoutedInvocation"("sessionId");
CREATE UNIQUE INDEX "RoutedInvocation_accessKeyId_idempotencyKey_key" ON "RoutedInvocation"("accessKeyId", "idempotencyKey");
