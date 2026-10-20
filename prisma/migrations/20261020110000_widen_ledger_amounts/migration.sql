-- Widen integer micro-units in place. No balances, units, assets or prices change.
ALTER TABLE "Lease"
    ALTER COLUMN "budget" TYPE BIGINT,
    ALTER COLUMN "spent" TYPE BIGINT,
    ALTER COLUMN "reserved" TYPE BIGINT,
    ALTER COLUMN "settled" TYPE BIGINT,
    ALTER COLUMN "writtenOff" TYPE BIGINT;
ALTER TABLE "MeterRequest"
    ALTER COLUMN "reservation" TYPE BIGINT,
    ALTER COLUMN "cost" TYPE BIGINT;
ALTER TABLE "Settlement"
    ALTER COLUMN "amount" TYPE BIGINT,
    ALTER COLUMN "cumulative" TYPE BIGINT;
ALTER TABLE "LedgerEntry" ALTER COLUMN "amount" TYPE BIGINT;
