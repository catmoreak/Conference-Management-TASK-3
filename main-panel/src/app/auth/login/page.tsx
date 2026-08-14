"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "~/server/better-auth/client";
import { useAuth } from "~/app/_components/AuthProvider";
import { useLanguage } from "~/app/_components/LanguageContext";

export default function LoginPage() {
  const router = useRouter();
  const { user, refetch } = useAuth();
  const { lang, setLang, t } = useLanguage();

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
          setError(t.auth.suspendedAccount);
        } else {
          setError(signInError.message ?? t.auth.invalidCreds);
        }
        setLoading(false);
        return;
      }

      const session = await authClient.getSession();
      if (session.data?.user && !session.data.user.twoFactorEnabled) {
        await refetch();
      } else {
        setIsMfaStep(true);
      }
    } catch (err) {
      console.error(err);
      setError(t.auth.unexpectedError);
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
        setError(mfaError.message ?? t.auth.mfaFailed);
        setLoading(false);
        return;
      }

      await refetch();
    } catch (err) {
      console.error(err);
      setError(t.auth.mfaFailed);
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
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="text-left">
                <span className="font-bold text-lg block leading-none">{t.brand}</span>
                <span className="text-[10px] text-[#10B981] font-bold tracking-widest uppercase">{t.platform}</span>
              </div>
            </div>
          </div>
          {/* EN/JP indicator */}
          <div className="inline-flex border border-gray-800 rounded-lg p-1 bg-[#1A2333]/50 text-xs">
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`px-2.5 py-1 rounded font-bold transition-colors ${
                lang === "en" ? "bg-[#10B981] text-[#0B1220]" : "text-gray-400 hover:text-white"
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang("ja")}
              className={`px-2.5 py-1 rounded font-bold transition-colors ${
                lang === "ja" ? "bg-[#10B981] text-[#0B1220]" : "text-gray-400 hover:text-white"
              }`}
            >
              JP
            </button>
          </div>
        </div>

        {/* Center content */}
        <div className="max-w-xl my-auto space-y-8">
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight">
            {t.auth.heroTitle}
          </h1>
          <p className="text-gray-300 text-base leading-relaxed">
            {t.auth.heroSub}
          </p>

          <ul className="space-y-4">
            {[
              t.auth.feature1,
              t.auth.feature2,
              t.auth.feature3,
              t.auth.feature4,
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
            <span className="font-bold text-xl text-[#0B1220]">{t.brand}</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-[#0B1220] tracking-tight">
              {t.auth.welcomeBack}
            </h2>
            <p className="text-sm text-gray-500 mt-2">
              {t.auth.signInSub}
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
                  {t.auth.emailLabel}
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
                  {t.auth.passwordLabel}
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
                {loading ? t.actions.verifying : t.actions.login}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="mfaCode"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2"
                >
                  {t.auth.verificationCodeLabel}
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  {t.auth.mfaHelp}
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
                {loading ? t.actions.verifying : t.actions.verifyCode}
              </button>

              <button
                type="button"
                onClick={() => setIsMfaStep(false)}
                className="w-full bg-transparent hover:bg-gray-50 text-gray-600 hover:text-gray-900 border border-gray-200 py-2.5 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#0B1220]"
              >
                {t.auth.backToSignIn}
              </button>
            </form>
          )}

          <div className="mt-8 text-center">
            <span className="text-xs text-gray-400 hover:text-[#0B1220] cursor-pointer transition font-medium">
              {t.auth.applyForOrganizer}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
