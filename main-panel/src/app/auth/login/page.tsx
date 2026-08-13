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
  const [showPassword, setShowPassword] = useState(false);

  // Redirection when authenticated
  useEffect(() => {
    if (user) {
      if (user.mustResetPassword) {
        router.replace("/auth/onboarding");
      } else if (user.role === "admin") {
        router.replace("/dashboard/admin");
      } else if (user.role === "reviewer") {
        router.replace("/dashboard/staff");
      } else if (user.role === "presenter") {
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
    <div className="flex-1 min-h-screen grid grid-cols-1 md:grid-cols-12 bg-bg-primary">
      {/* Left Dark Navy Panel */}
      <div className="hidden md:flex md:col-span-6 lg:col-span-7 bg-[#0B1220] text-white p-12 flex-col justify-between relative overflow-hidden">
        {/* Top brand & language */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#10B981] rounded-lg flex items-center justify-center text-[#0B1220]">
                {/* Green lightning bolt / shield check icon */}
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="text-left">
                <span className="font-bold text-lg block leading-none">Podium</span>
                <span className="text-[10px] text-[#10B981] font-bold tracking-widest uppercase">Platform</span>
              </div>
            </div>
          </div>
          {/* EN/JP indicator */}
          <div className="inline-flex border border-gray-800 rounded-lg p-1 bg-[#1A2333]/50 text-xs">
            <span className="px-2.5 py-1 rounded bg-[#10B981] text-[#0B1220] font-bold">EN</span>
            <span className="px-2.5 py-1 rounded text-gray-400 font-semibold cursor-pointer">JP</span>
          </div>
        </div>

        {/* Center content */}
        <div className="max-w-xl my-auto space-y-8">
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight">
            Seamless presentation delivery for your events
          </h1>
          <p className="text-gray-300 text-base leading-relaxed">
            Manage speaker slides, monitor live sessions, and drive podium displays in real time.
          </p>

          <ul className="space-y-4">
            {[
              "Live session slide control",
              "Real-time display syncing",
              "Speaker material uploads",
              "Presentation audit logging"
            ].map((text, idx) => (
              <li key={idx} className="flex items-center gap-3 text-sm text-gray-200">
                <svg className="w-5 h-5 text-[#10B981] fill-current flex-shrink-0" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {text}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom footer */}
        <div className="text-xs text-gray-500">
          © 2026 Podium
        </div>
      </div>

      {/* Right Login Panel */}
      <div className="col-span-1 md:col-span-6 lg:col-span-5 flex items-center justify-center p-8 md:p-12 lg:p-16 bg-[#F8FAFC]">
        <div className="w-full max-w-md">
          {/* Mobile logo header if screen is small */}
          <div className="md:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-8 h-8 bg-[#10B981] rounded-lg flex items-center justify-center text-[#0B1220]">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="font-bold text-xl text-[#0B1220]">Podium</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-[#0B1220] tracking-tight">
              Welcome back
            </h2>
            <p className="text-sm text-gray-500 mt-2">
              Sign in to your administrator account
            </p>
          </div>

          {error && (
            <div
              className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm flex gap-3"
              role="alert"
              aria-live="assertive"
            >
              <span className="font-semibold" aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {!isMfaStep ? (
            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  suppressHydrationWarning
                  disabled={loading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#0B1220] text-gray-900 placeholder:text-gray-400 rounded-xl px-4 py-3 text-sm transition outline-none focus:ring-2 focus:ring-[#0B1220]/10"
                  placeholder="admin@example.com"
                  autoComplete="email"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    suppressHydrationWarning
                    disabled={loading}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#0B1220] text-gray-900 placeholder:text-gray-400 rounded-xl px-4 py-3 text-sm transition outline-none focus:ring-2 focus:ring-[#0B1220]/10 pr-10"
                    placeholder="Password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                suppressHydrationWarning
                className="w-full bg-[#0B1220] hover:bg-[#1A253C] text-white font-semibold py-3 px-4 rounded-xl text-sm transition shadow-sm hover:shadow active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#0B1220] disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Login"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="mfaCode"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2"
                >
                  Verification Code
                </label>
                <p className="text-xs text-gray-500 mb-3">
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
                  className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#0B1220] text-gray-900 placeholder:text-gray-400 rounded-xl px-4 py-3 text-sm text-center font-mono tracking-widest transition outline-none focus:ring-2 focus:ring-[#0B1220]/10"
                  placeholder="000000"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                suppressHydrationWarning
                className="w-full bg-[#0B1220] hover:bg-[#1A253C] text-white font-semibold py-3 px-4 rounded-xl text-sm transition shadow-sm hover:shadow active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#0B1220] disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify Code"}
              </button>

              <button
                type="button"
                onClick={() => setIsMfaStep(false)}
                className="w-full bg-transparent hover:bg-gray-50 text-gray-600 hover:text-gray-900 border border-gray-200 py-2.5 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#0B1220]"
              >
                Back to Sign In
              </button>
            </form>
          )}

          <div className="mt-8 text-center">
            <span className="text-xs text-gray-400 hover:text-[#0B1220] cursor-pointer transition font-medium">
              Apply for Organizer Account
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
