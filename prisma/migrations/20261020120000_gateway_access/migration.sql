ALTER TABLE "Listing" ADD COLUMN "proxyUrl" TEXT, ADD COLUMN "proxySecret" TEXT;
CREATE INDEX "Listing_baseUrl_idx" ON "Listing"("baseUrl");
CREATE INDEX "Listing_proxyUrl_idx" ON "Listing"("proxyUrl");

CREATE TABLE "EndpointPolicy" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EndpointPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EndpointPolicy_kind_check" CHECK ("kind" IN ('GATEWAY', 'PROXY'))
);
CREATE UNIQUE INDEX "EndpointPolicy_kind_url_key" ON "EndpointPolicy"("kind", "url");

-- Existing destinations are not silently approved by the new policy.
UPDATE "Listing" SET "enabled" = false, "status" = 'BLOCKED'
WHERE "kind" = 'gateway' AND "transport" = 'direct';
