ALTER TABLE "Listing"
ADD COLUMN "transport" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN "connectorHash" TEXT,
ADD COLUMN "connectorSeenAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Listing_connectorHash_key" ON "Listing"("connectorHash");
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_transport_check"
CHECK ("transport" IN ('direct', 'local') AND ("transport" <> 'local' OR ("kind" = 'gateway' AND "baseUrl" IS NULL AND "secret" IS NULL)));
CREATE TABLE "ConnectorJob" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "requestId" TEXT NOT NULL UNIQUE REFERENCES "MeterRequest"("id"),
 "listingId" TEXT NOT NULL REFERENCES "Listing"("id"),
 "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "claimedBy" TEXT,
 "text" TEXT NOT NULL DEFAULT '',
 "revision" INTEGER NOT NULL DEFAULT 0,
 "result" JSONB,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ConnectorJob_status_check" CHECK ("status" IN ('QUEUED','CLAIMED','COMPLETE','FAILED','CANCELLED')),
 CONSTRAINT "ConnectorJob_text_check" CHECK (octet_length("text") <= 65536)
);
CREATE INDEX "ConnectorJob_listingId_status_createdAt_idx" ON "ConnectorJob"("listingId", "status", "createdAt");
