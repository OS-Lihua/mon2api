-- Keep every lease within its prepaid budget even if a service update is incorrect.
-- Cast before summing because Prisma Int maps to PostgreSQL INTEGER.
ALTER TABLE "Lease"
  ADD CONSTRAINT "Lease_budget_positive" CHECK ("budget" > 0),
  ADD CONSTRAINT "Lease_balances_nonnegative" CHECK (
    "spent" >= 0 AND "reserved" >= 0 AND "settled" >= 0 AND "writtenOff" >= 0
  ),
  ADD CONSTRAINT "Lease_spent_reserved_within_budget" CHECK (
    "spent"::bigint + "reserved"::bigint <= "budget"::bigint
  ),
  ADD CONSTRAINT "Lease_settled_writtenOff_within_spent" CHECK (
    "settled"::bigint + "writtenOff"::bigint <= "spent"::bigint
  );
