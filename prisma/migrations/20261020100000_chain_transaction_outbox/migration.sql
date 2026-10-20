-- Remove implicit metadata without changing any existing balance or asset.
ALTER TABLE "ChainBinding" ALTER COLUMN "asset" DROP DEFAULT;
ALTER TABLE "ChainBinding" ALTER COLUMN "tokenDecimals" DROP DEFAULT;

CREATE TABLE "ChainTransaction" (
    "id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "raw" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChainTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChainTransaction_hash_key" ON "ChainTransaction"("hash");
CREATE UNIQUE INDEX "ChainTransaction_sender_nonce_key" ON "ChainTransaction"("sender", "nonce");
CREATE INDEX "ChainTransaction_sender_status_nonce_idx" ON "ChainTransaction"("sender", "status", "nonce");
