-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inputRate" INTEGER NOT NULL,
    "outputRate" INTEGER NOT NULL,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "baseUrl" TEXT,
    "secret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputRate" INTEGER NOT NULL,
    "outputRate" INTEGER NOT NULL,
    "termsHash" TEXT NOT NULL,
    "budget" INTEGER NOT NULL,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "settled" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openTx" TEXT,
    "closeTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterRequest" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reservation" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "usageSource" TEXT NOT NULL DEFAULT 'missing',
    "upstreamId" TEXT,
    "errorCode" TEXT,
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeterRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessKey" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "cumulative" INTEGER NOT NULL,
    "receiptsHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletNonce" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_owner_idx" ON "Listing"("owner");

-- CreateIndex
CREATE INDEX "Lease_consumer_status_idx" ON "Lease"("consumer", "status");

-- CreateIndex
CREATE INDEX "MeterRequest_status_createdAt_idx" ON "MeterRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeterRequest_sessionId_idempotencyKey_key" ON "MeterRequest"("sessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AccessKey_hash_key" ON "AccessKey"("hash");

-- CreateIndex
CREATE INDEX "AccessKey_owner_idx" ON "AccessKey"("owner");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_sessionId_nonce_key" ON "Settlement"("sessionId", "nonce");

-- CreateIndex
CREATE INDEX "LedgerEntry_sessionId_createdAt_idx" ON "LedgerEntry"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletNonce_message_key" ON "WalletNonce"("message");

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterRequest" ADD CONSTRAINT "MeterRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterRequest" ADD CONSTRAINT "MeterRequest_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessKey" ADD CONSTRAINT "AccessKey_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
