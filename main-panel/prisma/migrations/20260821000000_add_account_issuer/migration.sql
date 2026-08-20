-- Better Auth v1.4+ expects account identity by (issuer, accountId).
-- Backfill existing rows from providerId so legacy accounts remain sign-in compatible.
ALTER TABLE "account"
    ADD COLUMN "issuer" TEXT;

UPDATE "account"
SET "issuer" = CASE
    WHEN "providerId" = 'credential' THEN 'local:credential'
    ELSE 'local:oauth:' || "providerId"
END
WHERE "issuer" IS NULL;

ALTER TABLE "account"
    ALTER COLUMN "issuer" SET NOT NULL;

CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");
