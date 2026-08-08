/**
 * Shadow-check harness for the RBAC migration (plan step 4).
 *
 * Purpose: let each of the 9(+1) existing rbac.ts call sites be switched to
 * route through here with ZERO behavioral risk, ahead of the new
 * scoped-authorization module actually existing. The legacy check stays
 * fully authoritative -- its return value, and its thrown error's exact
 * shape (rbac.ts throws `{ status, error }` objects, not Error instances),
 * pass through unchanged. The candidate check's result is observed only: it
 * can never change what shadowCompare returns or throws.
 *
 * When the two disagree, one row lands in authz_shadow_mismatches instead
 * of a console line -- durable and queryable for the length of the
 * migration window, rather than lost in serverless function logs.
 *
 * Cutover (later in step 4) means changing which side is authoritative, not
 * introducing this wrapper for the first time -- call sites that already
 * route through shadowCompare don't need a second migration.
 */

import { db } from "~/server/db";
import { isPrismaMissingTableError } from "./prisma-errors";

interface SafeResult<T> {
  allowed: boolean;
  value?: T;
  /** The raw thrown value, preserved so shadowCompare can re-throw it unchanged. */
  error?: unknown;
  /** Human-readable summary of `error`, used only for the mismatch log. */
  reason?: string;
}

async function runSafely<T>(fn: () => T | Promise<T>): Promise<SafeResult<T>> {
  try {
    const value = await fn();
    return { allowed: true, value };
  } catch (error) {
    return { allowed: false, error, reason: describeError(error) };
  }
}

/**
 * rbac.ts's assertRole/assertPermissions throw plain `{ status, error }`
 * objects (see src/server/auth/rbac.ts), not Error instances -- route
 * handlers catch and read `.error`/`.message` off whatever was thrown. This
 * covers that shape plus a plain Error fallback for the candidate side,
 * which may not exist yet or may throw differently once it does.
 */
function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { error?: unknown; message?: unknown };
    if (typeof e.error === "string") return e.error;
    if (typeof e.message === "string") return e.message;
  }
  return String(error);
}

export interface MismatchLogEntry {
  checkName: string;
  actorId: string;
  legacyAllowed: boolean;
  legacyReason: string | null;
  candidateAllowed: boolean;
  candidateReason: string | null;
}

/** Default persistence: writes to authz_shadow_mismatches. Never throws -- a logging failure must not affect the real authorization outcome, same convention as writeAuditLog. */
async function logMismatchToDb(entry: MismatchLogEntry): Promise<void> {
  try {
    await db.authzShadowMismatch.create({
      data: {
        checkName: entry.checkName,
        actorId: entry.actorId,
        legacyAllowed: entry.legacyAllowed,
        legacyReason: entry.legacyReason,
        candidateAllowed: entry.candidateAllowed,
        candidateReason: entry.candidateReason,
      },
    });
  } catch (error) {
    if (isPrismaMissingTableError(error)) return;
    console.error("[shadow-check] Failed to log mismatch:", error);
  }
}

export interface ShadowCompareParams<T> {
  /** Identifies the call site, e.g. "admin/accounts:assertRole". Goes straight into the mismatch log. */
  checkName: string;
  actorId: string;
  /** The existing rbac.ts-based check. Authoritative: its return/throw is exactly what shadowCompare returns/throws. */
  legacy: () => T | Promise<T>;
  /** The new authz-module check being evaluated. Observed only -- its return value and any exception are captured for comparison but never surfaced to the caller. */
  candidate: () => unknown | Promise<unknown>;
  /**
   * Override for where mismatches get logged. Defaults to the real DB
   * table; tests inject an in-memory collector instead so the harness's
   * comparison logic can be verified without a live database.
   */
  logMismatch?: (entry: MismatchLogEntry) => Promise<void>;
}

export async function shadowCompare<T>(params: ShadowCompareParams<T>): Promise<T> {
  const logMismatch = params.logMismatch ?? logMismatchToDb;

  const [legacyResult, candidateResult] = await Promise.all([
    runSafely(params.legacy),
    runSafely(() => params.candidate()),
  ]);

  if (legacyResult.allowed !== candidateResult.allowed) {
    await logMismatch({
      checkName: params.checkName,
      actorId: params.actorId,
      legacyAllowed: legacyResult.allowed,
      legacyReason: legacyResult.allowed ? null : (legacyResult.reason ?? null),
      candidateAllowed: candidateResult.allowed,
      candidateReason: candidateResult.allowed ? null : (candidateResult.reason ?? null),
    });
  }

  if (!legacyResult.allowed) {
    // Re-throw the ORIGINAL thrown value, not a synthesized Error -- route
    // handlers depend on the exact { status, error } shape rbac.ts throws.
    throw legacyResult.error;
  }
  return legacyResult.value as T;
}
