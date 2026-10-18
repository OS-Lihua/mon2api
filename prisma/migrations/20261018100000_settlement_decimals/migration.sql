-- Preserve historical denominations. Never convert balances or change asset symbols.
ALTER TABLE "ChainBinding" ADD COLUMN "tokenDecimals" INTEGER NOT NULL DEFAULT 6;
UPDATE "ChainBinding" SET "tokenDecimals" = 18 WHERE "token" = '0x0000000000000000000000000000000000000000';
ALTER TABLE "ChainBinding" ADD CONSTRAINT "ChainBinding_tokenDecimals_check" CHECK ("tokenDecimals" BETWEEN 6 AND 18);
-- Native symbols now vary by chain; retain the original token/address invariant.
ALTER TABLE "ChainBinding" DROP CONSTRAINT "ChainBinding_asset_valid";
ALTER TABLE "ChainBinding" ADD CONSTRAINT "ChainBinding_asset_valid"
 CHECK (("asset" IN ('ETH', 'BNB', 'POL', 'AVAX', 'MON') AND "token" = '0x0000000000000000000000000000000000000000' AND "tokenDecimals" = 18)
 OR ("asset" IN ('USDT', 'USDC', 'dUSD') AND "token" <> '0x0000000000000000000000000000000000000000'));
