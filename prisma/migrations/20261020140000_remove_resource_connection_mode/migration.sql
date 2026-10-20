-- Resources use a gateway URL and inference API key without an account-login category.
ALTER TABLE "Listing" DROP COLUMN "connectionMode";
