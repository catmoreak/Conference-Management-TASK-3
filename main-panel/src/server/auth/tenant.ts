/**
 * Tenant-scope enforcement.
 *
 * Every request touching a tenant-scoped resource must verify
 * resource.tenant_id === session.user.tenant_id.
 * Rejects with 403 if mismatched, even when the caller guesses an ID.
 */

export interface TenantScopedSession {
  user: {
    tenantId?: string | null;
    role?: string | null;
  };
}

/**
 * Assert that the authenticated user belongs to the same tenant as the resource.
 *
 * @param session - The authenticated session
 * @param resourceTenantId - The tenant_id of the resource being accessed
 * @param allowAdminCrossTenant - If true, admin users can access any tenant (default: false)
 *
 * @throws Object with `status` and `error` if tenant mismatch
 */
export function assertTenantAccess(
  session: TenantScopedSession,
  resourceTenantId: string | null | undefined,
  allowAdminCrossTenant = false,
): void {
  // If the resource has no tenant, it's a global resource — allow access
  if (!resourceTenantId) return;

  // Admin cross-tenant bypass (opt-in per call site)
  if (allowAdminCrossTenant && session.user.role === "admin") return;

  // User must have a tenant assigned
  if (!session.user.tenantId) {
    throw {
      status: 403,
      error: "User has no tenant assigned and cannot access tenant-scoped resources",
    };
  }

  if (session.user.tenantId !== resourceTenantId) {
    throw {
      status: 403,
      error: "Tenant mismatch: you do not have access to this resource",
    };
  }
}

/**
 * Build a Prisma `where` clause that scopes queries to the user's tenant.
 * For admin with cross-tenant access, returns an empty object (no filter).
 */
export function tenantWhereClause(
  session: TenantScopedSession,
  allowAdminCrossTenant = false,
): { tenantId?: string } {
  if (allowAdminCrossTenant && session.user.role === "admin") {
    return {};
  }
  if (!session.user.tenantId) {
    throw {
      status: 403,
      error: "User has no tenant assigned",
    };
  }
  return { tenantId: session.user.tenantId };
}
