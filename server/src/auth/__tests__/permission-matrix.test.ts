import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, SERVICE_PERMISSIONS } from "../permissions.js";
import type { Role, ServiceId } from "../types.js";

/**
 * The generated exhaustive per-(role, permission) and per-(service,
 * permission) deny tests that used to live in this file now live in the
 * shared AuthzStoreHarness contract suite (src/testing/authz-contract-suite.ts)
 * so they run against both the in-memory fake and real Postgres -- see
 * src/testing/__tests__/authz-contract.*.test.ts. What's left here has no
 * store dependency at all: it's pure data validation of the matrix
 * declared in permissions.ts.
 */

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];
const ALL_SERVICE_IDS = Object.keys(SERVICE_PERMISSIONS) as ServiceId[];

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

// ---------------------------------------------------------------------------
// The forcing function: this must be edited by hand alongside any change to
// ROLE_PERMISSIONS / SERVICE_PERMISSIONS, so a grant added in permissions.ts
// without a matching, deliberate edit here fails CI instead of silently
// shipping.
// ---------------------------------------------------------------------------
describe("permission matrix snapshot", () => {
  it("role grants match the approved matrix", () => {
    const actual = Object.fromEntries(ALL_ROLES.map((role) => [role, sorted(ROLE_PERMISSIONS[role])]));

    expect(actual).toEqual({
      presenter: sorted(["submission:create", "submission:read", "submission:update", "submission:delete", "submission:download"]),
      reception_staff: sorted([
        "event:read",
        "session:read",
        "presenter:checkin",
        "presenter:read",
        "submission:create",
        "submission:read",
        "submission:update",
        "submission:delete",
        "submission:download",
      ]),
      reviewer: sorted(["event:read", "session:read", "submission:read", "submission:download", "submission:approve", "submission:reject"]),
      operator: sorted(["session:read", "playback:control", "playback:read"]),
      event_admin: sorted([
        "event:read",
        "event:update",
        "session:create",
        "session:update",
        "session:read",
        "staff:assign",
        "staff:read",
        "presenter:checkin",
        "presenter:read",
        "submission:read",
        "submission:download",
      ]),
      system_admin: sorted(
        PERMISSIONS.filter((p) => p !== "submission:read_raw" && p !== "submission:write_derived" && p !== "submission:read_approved"),
      ),
    });
  });

  it("service grants match the approved matrix", () => {
    const actual = Object.fromEntries(ALL_SERVICE_IDS.map((id) => [id, sorted(SERVICE_PERMISSIONS[id])]));

    expect(actual).toEqual({
      "conversion-worker": sorted(["submission:read_raw", "submission:write_derived"]),
      "malware-scanner": sorted(["submission:read_raw"]),
      "podium-app": sorted(["submission:read_approved"]),
    });
  });

  it("every declared permission is granted to at least one role or service", () => {
    const grantedAnywhere = new Set<string>([
      ...ALL_ROLES.flatMap((role) => ROLE_PERMISSIONS[role]),
      ...ALL_SERVICE_IDS.flatMap((id) => SERVICE_PERMISSIONS[id]),
    ]);

    const orphaned = PERMISSIONS.filter((p) => !grantedAnywhere.has(p));

    expect(orphaned).toEqual([]);
  });
});
