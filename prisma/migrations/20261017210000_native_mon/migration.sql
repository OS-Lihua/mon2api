-- Metadata only: never convert legacy dUSD amounts into MON.
ALTER TABLE "ChainBinding" ADD COLUMN "asset" TEXT NOT NULL DEFAULT 'dUSD';
ALTER TABLE "ChainBinding" ADD CONSTRAINT "ChainBinding_asset_valid"
  CHECK (("asset" = 'MON' AND "token" = '0x0000000000000000000000000000000000000000')
    OR ("asset" = 'dUSD' AND "token" <> '0x0000000000000000000000000000000000000000'));
