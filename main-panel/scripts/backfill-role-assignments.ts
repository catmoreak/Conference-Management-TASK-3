// Backfills user_role_assignments from the existing flat user.role/tenantId
// columns, so the new authz module has real data to check against instead
// of denying everyone with no_role_grant. Real, reusable, idempotent
// infrastructure -- safe to re-run; skips any user who already has an
// active grant rather than creating duplicates.
//
// Run: npx tsx scripts/backfill-role-assignments.ts [--apply]
// Without --apply: dry run, prints the mapping decisions and exits without
// writing anything. With --apply: writes the grants.
import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf-8");
  envFile.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || "";
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (key && !process.env[key]) process.env[key] = value;
    }
  });
}

const APPLY = process.argv.includes("--apply");

// ── Role mapping ────────────────────────────────────────────────────────
//
// admin -> system_admin: the only new-catalogue role with comprehensive,
//   unrestricted permissions, matching admin's "full access to everything."
//   Clean match.
//
// staff -> event_admin: closest OVERLAP (event:*/session:* management,
//   staff:assign) but NOT a full match. Old `staff` also had
//   material:upload/delete and dashboard:view -- neither has ANY equivalent
//   permission string in the new catalogue (no `material:*` permissions
//   exist there at all; audit:read is the closest thing to dashboard:view
//   but is system_admin-only). This is a genuine, unresolved coverage gap,
//   not something this backfill can paper over.
//
// pres_ops_staff -> operator: clean match for live-control:operate/view ->
//   playback:control/read. Same gap as staff: material:view/download has
//   NO equivalent (operator has zero submission:* permissions -- "material"
//   and "submission" may be the same real-world resource under different
//   names in the two systems, but nothing in either catalogue currently
//   asserts that; reconciling it is a policy decision, not backfill's job).
//
// Consequence worth stating up front: audit:read (what the audit/route.ts
// pilot checks) is ONLY in system_admin's permission set. Backfilling
// staff/pres_ops_staff users will NOT make them agree with legacy on that
// specific route -- legacy grants them dashboard:view, the new catalogue
// has no equivalent broad permission for non-admin roles. That is a real,
// substantive gap the pilot is correctly surfacing, not a backfill bug.
const ROLE_MAPPING: Record<string, { newRole: string; note: string }> = {
  admin: { newRole: "system_admin", note: "clean match -- comprehensive permissions in both systems" },
  staff: {
    newRole: "event_admin",
    note: "PARTIAL match -- no equivalent for material:upload/delete or dashboard:view in the new catalogue",
  },
  pres_ops_staff: {
    newRole: "operator",
    note: "PARTIAL match -- no equivalent for material:view/download (operator has zero submission:* permissions)",
  },
};

interface MappingDecision {
  userId: string;
  email: string;
  oldRole: string;
  oldTenantId: string | null;
  newRole: string;
  grantTenantId: string | null;
  scopeType: "global";
  action: "grant" | "skip_already_granted" | "skip_no_tenant_no_mapping";
  reason: string;
}

async function main() {
  const { db } = await import("../src/server/db");

  const users = await db.user.findMany({ select: { id: true, email: true, role: true, tenantId: true } });
  console.log(`Found ${users.length} user(s) in "user" table.\n`);

  const beforeCount = await db.$queryRawUnsafe<{ count: number }[]>(`select count(*)::int as count from user_role_assignments`);
  console.log(`user_role_assignments row count BEFORE: ${beforeCount[0]?.count}\n`);

  const decisions: MappingDecision[] = [];

  for (const user of users) {
    const mapping = ROLE_MAPPING[user.role];
    if (!mapping) {
      decisions.push({
        userId: user.id, email: user.email, oldRole: user.role, oldTenantId: user.tenantId,
        newRole: "(none)", grantTenantId: null, scopeType: "global",
        action: "skip_no_tenant_no_mapping", reason: `unrecognized old role '${user.role}' -- no mapping defined`,
      });
      continue;
    }

    const existing = await db.$queryRawUnsafe<{ count: number }[]>(
      `select count(*)::int as count from user_role_assignments where user_id = $1 and revoked_at is null`,
      user.id,
    );
    if ((existing[0]?.count ?? 0) > 0) {
      decisions.push({
        userId: user.id, email: user.email, oldRole: user.role, oldTenantId: user.tenantId,
        newRole: mapping.newRole, grantTenantId: user.tenantId, scopeType: "global",
        action: "skip_already_granted", reason: "user already has an active user_role_assignments row -- idempotent, not re-granting",
      });
      continue;
    }

    // admin with no tenantId: platform-wide is the only coherent mapping --
    // there's no tenant to scope them into, this is NOT inferring
    // "cross-tenant intent" (allowAdminCrossTenant is unused anywhere in
    // the codebase and carries no per-user signal at all).
    //
    // staff/pres_ops_staff with no tenantId: explicitly flagged, NOT
    // defaulted to platform-wide -- granting a non-admin role platform-wide
    // reach because we don't know their tenant would be a real over-grant,
    // not a safe guess.
    if (user.role !== "admin" && !user.tenantId) {
      decisions.push({
        userId: user.id, email: user.email, oldRole: user.role, oldTenantId: user.tenantId,
        newRole: mapping.newRole, grantTenantId: null, scopeType: "global",
        action: "skip_no_tenant_no_mapping",
        reason: `role '${user.role}' has no tenantId and is not admin -- refusing to guess platform-wide scope for a non-admin role; needs manual resolution`,
      });
      continue;
    }

    decisions.push({
      userId: user.id, email: user.email, oldRole: user.role, oldTenantId: user.tenantId,
      newRole: mapping.newRole, grantTenantId: user.tenantId ?? null, scopeType: "global",
      action: "grant",
      reason: user.tenantId
        ? `${mapping.note} -- tenant-scoped to '${user.tenantId}'`
        : `${mapping.note} -- no tenantId on this admin, so platform-wide (tenant_id=null) is the only coherent mapping`,
    });
  }

  console.log("Mapping decisions:");
  console.log("=".repeat(100));
  for (const d of decisions) {
    console.log(`  ${d.email} (${d.oldRole}, tenantId=${d.oldTenantId ?? "null"})`);
    console.log(`    -> ${d.action}: newRole=${d.newRole}, grantTenantId=${d.grantTenantId ?? "null"}, scopeType=global`);
    console.log(`    reason: ${d.reason}`);
  }
  console.log("=".repeat(100));

  const toGrant = decisions.filter((d) => d.action === "grant");
  const toSkipGranted = decisions.filter((d) => d.action === "skip_already_granted");
  const toSkipNoMapping = decisions.filter((d) => d.action === "skip_no_tenant_no_mapping");
  console.log(`\nSummary: ${toGrant.length} to grant, ${toSkipGranted.length} already granted (skipped), ${toSkipNoMapping.length} flagged for manual resolution (skipped)\n`);

  if (!APPLY) {
    console.log("DRY RUN -- no rows written. Re-run with --apply to write these grants.");
    await db.$disconnect();
    return;
  }

  for (const d of toGrant) {
    await db.$executeRawUnsafe(
      `insert into user_role_assignments (id, user_id, role, tenant_id, scope_type, scope_id, granted_by)
       values (gen_random_uuid()::text, $1, $2, $3, 'global', null, 'backfill-script')`,
      d.userId, d.newRole, d.grantTenantId,
    );
  }

  const afterCount = await db.$queryRawUnsafe<{ count: number }[]>(`select count(*)::int as count from user_role_assignments`);
  console.log(`user_role_assignments row count AFTER: ${afterCount[0]?.count} (was ${beforeCount[0]?.count}, +${toGrant.length} granted)`);

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("BACKFILL SCRIPT CRASHED:", e);
  process.exit(1);
});
