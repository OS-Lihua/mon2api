ALTER TABLE "Listing"
ADD COLUMN "connectorCatalog" JSONB,
ADD COLUMN "connectorCatalogAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_discovery_draft_check"
CHECK ("status" <> 'DISCOVERING' OR ("transport" = 'local' AND NOT "enabled" AND "model" = ''));
