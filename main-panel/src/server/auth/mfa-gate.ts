/**
 * MFA enrollment gate.
 *
 * Ensures that no user reaches an authenticated session without having
 * completed MFA enrollment at least once. Users who haven't enrolled
 * are blocked from accessing protected resources and directed to the
 * MFA setup page.
 */

export interface MfaGateSession {
  user: {
    twoFactorEnabled?: boolean | null;
    mustResetPassword?: boolean;
  };
}

/**
 * Assert that the user has completed MFA enrollment.
 *
 * @param session - The authenticated session
 * @throws Object with `status`, `error`, and `code` if MFA is not enrolled
 */
export function assertMfaEnrolled(session: MfaGateSession): void {
  if (!session.user.twoFactorEnabled) {
    throw {
      status: 403,
      error: "MFA enrollment required. Please set up two-factor authentication.",
      code: "MFA_REQUIRED",
    };
  }
}

/**
 * Assert that the user has completed their initial password reset.
 *
 * @param session - The authenticated session
 * @throws Object with `status`, `error`, and `code` if password reset is pending
 */
export function assertPasswordReset(session: MfaGateSession): void {
  if (session.user.mustResetPassword) {
    throw {
      status: 403,
      error: "Password change required. Please update your password.",
      code: "PASSWORD_RESET_REQUIRED",
    };
  }
}

/**
 * Combined gate: checks both password reset and MFA enrollment.
 * Call this in protectedProcedure middleware to enforce both requirements.
 */
export function assertOnboardingComplete(session: MfaGateSession): void {
  assertPasswordReset(session);
  assertMfaEnrolled(session);
}
