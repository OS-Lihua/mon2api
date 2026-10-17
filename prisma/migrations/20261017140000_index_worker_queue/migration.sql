-- Bound the worker's active-lease audit and closing-lease scan by status and id.
CREATE INDEX "Lease_status_id_idx" ON "Lease"("status", "id");
