-- Revert 20260821000000_add_account_issuer: better-auth 1.6.25 never sets
-- `issuer` on the account row it creates (it only writes providerId/accountId),
-- so the NOT NULL constraint added by that migration broke every new sign-up
-- with a Prisma validation error ("Argument `issuer` is missing").
DROP INDEX IF EXISTS "account_issuer_accountId_key";

ALTER TABLE "account"
    DROP COLUMN IF EXISTS "issuer";
