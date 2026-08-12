"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "~/server/better-auth/client";
import { useAuth } from "~/app/_components/AuthProvider";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, refetch } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);

  const [totpQrCode, setTotpQrCode] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Redirect to target workspace dashboard if onboarding is complete
  useEffect(() => {
    if (user && !user.mustResetPassword) {
      if (user.role === "admin") {
        router.replace("/dashboard/admin");
      } else if (user.role === "reviewer") {
        router.replace("/dashboard/staff");
      } else if (user.role === "presenter") {
        router.replace("/dashboard/pres-ops");
      }
    }
  }, [user, router]);

  // Sync state with user properties
  useEffect(() => {
    if (user) {
      setPasswordChanged(!user.mustResetPassword);
      setMfaEnrolled(user.twoFactorEnabled);
    }
  }, [user]);

  // Generate MFA details if password is changed but MFA isn't enrolled yet
  useEffect(() => {
    if (passwordChanged && !mfaEnrolled && !totpQrCode) {
      void generateMfaDetails();
    }
  }, [passwordChanged, mfaEnrolled, totpQrCode]);

  const generateMfaDetails = async () => {
    try {
      const res = await authClient.twoFactor.enable({
        issuer: "Conference Management",
      });
      if (res.data) {
        setTotpQrCode(res.data.totpURI ?? "");
        // fallback message or parsing details if secret not exposed
        setBackupCodes(res.data.backupCodes ?? []);
      }
    } catch (err) {
      console.error("MFA generation failed:", err);
      setError("Failed to initialize multi-factor setup.");
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      // Better Auth changePassword requires currentPassword and newPassword
      // Since it's a forced reset on temporary password, let's ask Better Auth client to update it.
      // Better Auth has changePassword client function.
      const { error: resetError } = await authClient.changePassword({
        currentPassword,
        newPassword: password,
      });

      if (resetError) {
        setError(resetError.message ?? "Failed to change password.");
        setLoading(false);
        return;
      }

      setPasswordChanged(true);
      await refetch();
    } catch (err) {
      console.error(err);
      setError("Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error: mfaError } = await authClient.twoFactor.verifyTotp({
        code: totpCode,
      });

      if (mfaError) {
        setError(mfaError.message ?? "Invalid validation code.");
        setLoading(false);
        return;
      }

      setMfaEnrolled(true);
      await refetch();
    } catch (err) {
      console.error(err);
      setError("Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-bg-primary px-4 py-12">
      <div className="w-full max-w-md bg-bg-secondary border border-border-soft rounded-xl p-8 shadow-hard-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            Account Onboarding
          </h1>
          <p className="text-sm text-text-secondary mt-2">
            Finish configuring security protections to activate access
          </p>
        </div>

        {error && (
          <div
            className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm flex gap-3"
            role="alert"
            aria-live="assertive"
          >
            <span className="font-semibold" aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {!passwordChanged ? (
          <form onSubmit={handlePasswordReset} className="space-y-6">
            <h2 className="text-lg font-semibold text-text-primary">1. Reset Password</h2>
            <p className="text-xs text-text-secondary">
              For security, you must update your temporary credential before logging in.
            </p>

            <div>
              <label
                htmlFor="current-password"
                className="block text-sm font-semibold text-text-secondary mb-2"
              >
                Current Password (Temporary Password)
              </label>
              <input
                id="current-password"
                type="password"
                required
                disabled={loading}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-white border border-border-soft hover:border-accent-slate focus:border-accent-blue text-text-primary placeholder:text-text-muted rounded-lg px-4 py-3 text-sm transition outline-none focus:ring-2 focus:ring-accent-blue/20"
                placeholder="Enter your temporary password"
                autoComplete="current-password"
              />
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-semibold text-text-secondary mb-2"
              >
                New Password
              </label>
              <input
                id="new-password"
                type="password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white border border-border-soft hover:border-accent-slate focus:border-accent-blue text-text-primary placeholder:text-text-muted rounded-lg px-4 py-3 text-sm transition outline-none focus:ring-2 focus:ring-accent-blue/20"
                placeholder="New password (8+ chars)"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-sm font-semibold text-text-secondary mb-2"
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                disabled={loading}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-white border border-border-soft hover:border-accent-slate focus:border-accent-blue text-text-primary placeholder:text-text-muted rounded-lg px-4 py-3 text-sm transition outline-none focus:ring-2 focus:ring-accent-blue/20"
                placeholder="Confirm password"
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold py-3 px-4 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover active:translate-x-0.5 active:translate-y-0.5 hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-50"
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfaVerify} className="space-y-6">
            <h2 className="text-lg font-semibold text-text-primary">2. Multi-Factor Setup</h2>
            <p className="text-xs text-text-secondary">
              MFA setup is mandatory. Scan the QR code or key into your authenticator app.
            </p>

            <div className="flex flex-col items-center justify-center bg-white border border-border-soft p-4 rounded-lg shadow-hard-sm">
              {totpQrCode ? (
                <div className="bg-bg-primary p-2 rounded border border-border-soft mb-3">
                  <div className="w-48 h-48 flex items-center justify-center bg-bg-secondary text-text-secondary text-xs font-mono text-center px-4 border border-dashed border-border-soft">
                    Scan via QR app
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-muted py-6">Initializing authenticator details...</p>
              )}
            </div>

            {backupCodes.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-2">Emergency Recovery Codes:</p>
                <div className="grid grid-cols-2 gap-2 bg-white border border-border-soft p-3 rounded-lg text-[10px] font-mono text-text-secondary text-center shadow-hard-sm">
                  {backupCodes.map((code, idx) => (
                    <span key={idx}>{code}</span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="totpCode"
                className="block text-sm font-semibold text-text-secondary mb-2"
              >
                Verification Code
              </label>
              <input
                id="totpCode"
                type="text"
                required
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                disabled={loading}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="w-full bg-white border border-border-soft hover:border-accent-slate focus:border-accent-blue text-text-primary placeholder:text-text-muted rounded-lg px-4 py-3 text-sm text-center font-mono tracking-widest transition outline-none focus:ring-2 focus:ring-accent-blue/20"
                placeholder="000000"
              />
            </div>

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold py-3 px-4 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover active:translate-x-0.5 active:translate-y-0.5 hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Enable MFA"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (user) {
                    if (user.role === "admin") {
                      router.replace("/dashboard/admin");
                    } else if (user.role === "reviewer") {
                      router.replace("/dashboard/staff");
                    } else if (user.role === "presenter") {
                      router.replace("/dashboard/pres-ops");
                    }
                  }
                }}
                className="flex-1 bg-transparent hover:bg-bg-primary text-text-secondary hover:text-text-primary border border-border-soft hover:border-accent-slate py-3 px-4 rounded-lg text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent-blue shadow-hard-sm"
              >
                Skip MFA
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
