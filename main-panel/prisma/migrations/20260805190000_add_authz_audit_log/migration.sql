-- Structured, transaction-capable audit log for authorize.ts's
-- canUserPerform/authorizeMutationAndRun -- separate from the existing
-- general-purpose audit_log table (account changes, MFA resets, WS token
-- mints), which stays as-is. Matches server/'s audit_log table
-- (server/migrations/0001_authz_core.sql) 1:1. Purely additive, not wired
-- to any route yet.

-- CreateTable
CREATE TABLE "authz_audit_log" (
    "id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authz_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "authz_audit_log_occurred_at_idx" ON "authz_audit_log"("occurred_at");
CREATE INDEX "authz_audit_log_actor_idx" ON "authz_audit_log"("actor_type", "actor_id");
