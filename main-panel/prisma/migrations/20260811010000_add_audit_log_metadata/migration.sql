-- Migration: add_audit_log_metadata
-- Gives AuditLog a real structured column for request metadata, so
-- writeAuditLog() no longer has to smuggle JSON into the `result` string
-- (which broke plain status filtering, e.g. WHERE result = 'success').

ALTER TABLE "audit_log"
    ADD COLUMN "metadata" JSONB;
