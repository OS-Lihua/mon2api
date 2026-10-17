ALTER TABLE "Listing"
ADD COLUMN "connectorLaunchHash" TEXT,
ADD COLUMN "connectorLaunchExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Listing_connectorLaunchHash_key" ON "Listing"("connectorLaunchHash");
