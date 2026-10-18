-- Indexes for per-listing admission counts, provider dashboards and key revocation.
CREATE INDEX "Lease_provider_idx" ON "Lease"("provider");
CREATE INDEX "Lease_listingId_idx" ON "Lease"("listingId");
CREATE INDEX "AccessKey_sessionId_idx" ON "AccessKey"("sessionId");
