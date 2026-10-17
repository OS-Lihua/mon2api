ALTER TABLE "Listing"
ADD COLUMN "connectionMode" TEXT NOT NULL DEFAULT 'api';

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_connectionMode_check"
CHECK ("connectionMode" IN ('api', 'oauth_pool'));

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_oauth_pool_gateway_check"
CHECK ("connectionMode" <> 'oauth_pool' OR "kind" = 'gateway');
