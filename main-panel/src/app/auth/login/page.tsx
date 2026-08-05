"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "~/server/better-auth/client";
import { useAuth } from "~/app/_components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { user, refetch } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaStep, setIsMfaStep] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Redirection when authenticated
  useEffect(() => {
    if (user) {
      if (user.mustResetPassword) {
        router.replace("/auth/onboarding");
      } else if (user.role === "admin") {
        router.replace("/dashboard/admin");
      } else if (user.role === "staff") {
        router.replace("/dashboard/staff");
      } else if (user.role === "pres_ops_staff") {
        router.replace("/dashboard/pres-ops");
      }
    }
  }, [user, router]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: signInError } = await authClient.signIn.email({
        email,
        password,
      });

      if (signInError) {
        if (signInError.status === 403 && signInError.message?.includes("suspended")) {
          setError("Account is suspended.");
        } else {
          setError(signInError.message ?? "Invalid email or password.");
        }
        setLoading(false);
        return;
      }

      // If MFA is required (twoFactorEnabled or requires verification code)
      // Better Auth redirects/throws error or indicates MFA verification state.
      // Let's check if twoFactorRedirect or similar is active, or if we need to call totp.verify.
      // Better Auth TOTP login follows: signIn.email returns info if MFA is pending/required.
      // Normally, if MFA is enabled, we get an indication or error that requires TOTP verification.
      // In Better Auth `two-factor` plugin, when signIn is called and MFA is active, it triggers
      // a two-factor verification challenge. Let's handle verification input.
      
      // Let's query state or session to see if twoFactor is enabled.
      // If we need to verify TOTP, we can transition state:
      const session = await authClient.getSession();
      if (session.data?.user && !session.data.user.twoFactorEnabled) {
        // MFA not enabled, we logged in successfully
        await refetch();
      } else {
        // Assume MFA challenge active since we enabled TOTP plugin
        setIsMfaStep(true);
      }
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: mfaError } = await authClient.twoFactor.verifyTotp({
        code: mfaCode,
      });

      if (mfaError) {
        setError(mfaError.message ?? "Invalid verification code.");
        setLoading(false);
        return;
      }

      await refetch();
    } catch (err) {
      console.error(err);
      setError("MFA validation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-bg-primary px-4 py-12">
      <div className="w-full max-w-md bg-bg-secondary border border-border-soft rounded-xl p-8 shadow-hard-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            Podium Authentication
          </h1>
          <p className="text-sm text-text-secondary mt-2">
            Conference Presentation Management Console
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

        {!isMfaStep ? (
          <form onSubmit={handleLoginSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-text-secondary mb-2"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                suppressHydrationWarning
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white border border-border-soft hover:border-accent-slate focus:border-accent-blue text-text-primary placeholder:text-text-muted rounded-lg px-4 py-3 text-sm transition outline-none focus:ring-2 focus:ring-accent-blue/20"
                placeholder="admin@conference.local"
                autoComplete="email"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-text-secondary mb-2"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                suppressHydrationWarning
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white border border-border-soft hover:border-accent-slate focus:border-accent-blue text-text-primary placeholder:text-text-muted rounded-lg px-4 py-3 text-sm transition outline-none focus:ring-2 focus:ring-accent-blue/20"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              suppressHydrationWarning
              className="w-full bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold py-3 px-4 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover active:translate-x-0.5 active:translate-y-0.5 hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Sign In"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfaSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="mfaCode"
                className="block text-sm font-semibold text-text-secondary mb-2"
              >
                Verification Code
              </label>
              <p className="text-xs text-text-secondary mb-3">
                Enter the 6-digit TOTP code from your authenticator application.
              </p>
              <input
                id="mfaCode"
                type="text"
                required
                suppressHydrationWarning
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                disabled={loading}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className="w-full bg-white border border-border-soft hover:border-accent-slate focus:border-accent-blue text-text-primary placeholder:text-text-muted rounded-lg px-4 py-3 text-sm text-center font-mono tracking-widest transition outline-none focus:ring-2 focus:ring-accent-blue/20"
                placeholder="000000"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              suppressHydrationWarning
              className="w-full bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold py-3 px-4 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover active:translate-x-0.5 active:translate-y-0.5 hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify Code"}
            </button>

            <button
              type="button"
              onClick={() => setIsMfaStep(false)}
              className="w-full bg-transparent hover:bg-bg-primary text-text-secondary hover:text-text-primary border border-border-soft hover:border-accent-slate py-2.5 rounded-lg text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-blue shadow-hard-sm"
            >
              Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
