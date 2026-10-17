-- Keep paid settlement distinct from earned usage lost after on-chain closure.
-- Settlement.status = UNCOLLECTIBLE retains amount, cumulative, receiptsHash
-- and request links; txHash is only ever a settlement transaction.
-- Lease.closeTx and OPERATING_LOSS ledger entries retain closure/loss evidence.
ALTER TABLE "Lease" ADD COLUMN "writtenOff" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_writtenOff_nonnegative"
  CHECK ("writtenOff" >= 0);
