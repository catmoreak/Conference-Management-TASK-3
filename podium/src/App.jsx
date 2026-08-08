import React, { useEffect, useMemo, useState } from "react";
import { LogIn, Monitor, Power, ShieldCheck, Upload } from "lucide-react";

import { authClient, getAuthErrorMessage, getDisplayRole, mainPanelAuthUrl } from "./lib/auth";

function AuthField({ label, id, type, value, onChange, placeholder, autoComplete, disabled }) {
  return (
    <label className="auth-field" htmlFor={id}>
      <span className="auth-label">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className="auth-input"
      />
    </label>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="session-info-row">
      <span className="session-info-label">{label}</span>
      <span className="session-info-value">{value}</span>
    </div>
  );
}

export default function App() {
  const session = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaStep, setIsMfaStep] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Sign in with a staff account from main-panel.");

  const user = session.data?.user ?? null;

  useEffect(() => {
    if (session.isPending) {
      return;
    }

    if (user) {
      setStatus("Connected to main-panel.");
      setIsMfaStep(false);
      setError("");
      return;
    }

    setStatus("Authenticate to unlock the podium console.");
  }, [session.isPending, user]);

  const sessionSummary = useMemo(() => {
    if (!user) {
      return null;
    }

    return {
      displayName: user.name || user.email,
      role: getDisplayRole(user.role),
      status: user.status || "active",
      tenantId: user.tenantId || "",
    };
  }, [user]);

  const handleSignIn = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe: true,
      });

      if (result.error) {
        setError(getAuthErrorMessage(result.error, "Invalid credentials."));
        return;
      }

      if (result.data && (result.data.twoFactorRedirect || result.data.twoFactorMethods?.length)) {
        setIsMfaStep(true);
        setStatus("Two-factor verification required.");
        return;
      }

      await session.refetch();
    } catch (signInError) {
      setError(getAuthErrorMessage(signInError, "Unable to sign in."));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTotp = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: mfaCode.trim(),
      });

      if (result.error) {
        setError(getAuthErrorMessage(result.error, "Verification failed."));
        return;
      }

      setMfaCode("");
      setIsMfaStep(false);
      await session.refetch();
    } catch (verifyError) {
      setError(getAuthErrorMessage(verifyError, "Verification failed."));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    setError("");

    try {
      await authClient.signOut();
      await session.refetch();
    } catch (signOutError) {
      setError(getAuthErrorMessage(signOutError, "Unable to sign out."));
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="podium-auth-shell">
        <div className="podium-auth-card">
          <div className="podium-auth-header">
            <div className="podium-badge">
              <ShieldCheck size={16} />
              Secure access
            </div>
            <h1 className="podium-title">Podium authentication</h1>
            <p className="podium-description">
              Sign in with the main-panel account that is allowed to control this presentation machine.
            </p>
          </div>

          <div className="podium-auth-meta">
            <div className="podium-auth-meta-item">
              <Monitor size={16} />
              <span>{mainPanelAuthUrl}</span>
            </div>
            <div className="podium-auth-meta-item">
              <Upload size={16} />
              <span>Desktop console ready for uploads and screen share</span>
            </div>
          </div>

          {error ? (
            <div className="podium-alert" role="alert" aria-live="assertive">
              {error}
            </div>
          ) : (
            <div className="podium-status-copy">{status}</div>
          )}

          {!isMfaStep ? (
            <form className="auth-form" onSubmit={handleSignIn}>
              <AuthField
                label="Email"
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="staff@conference.local"
                autoComplete="email"
                disabled={loading}
              />
              <AuthField
                label="Password"
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
              />
              <button className="auth-button" type="submit" disabled={loading}>
                <LogIn size={16} />
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleVerifyTotp}>
              <AuthField
                label="Verification code"
                id="mfaCode"
                type="text"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                placeholder="000000"
                autoComplete="one-time-code"
                disabled={loading}
              />
              <button className="auth-button" type="submit" disabled={loading}>
                <ShieldCheck size={16} />
                {loading ? "Verifying..." : "Verify code"}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="podium-auth-shell">
      <div className="podium-auth-card">
        <div className="podium-auth-header">
          <div className="podium-badge">
            <ShieldCheck size={16} />
            Signed in
          </div>
          <h1 className="podium-title">Podium console</h1>
          <p className="podium-description">
            This workstation is authenticated against the main-panel server.
          </p>
        </div>

        {sessionSummary ? (
          <div className="session-panel">
            <InfoRow label="User" value={sessionSummary.displayName} />
            <InfoRow label="Role" value={sessionSummary.role} />
            <InfoRow label="Status" value={sessionSummary.status} />
            {sessionSummary.tenantId ? <InfoRow label="Tenant" value={sessionSummary.tenantId} /> : null}
          </div>
        ) : null}

        <div className="podium-status-copy">{status}</div>

        {error ? (
          <div className="podium-alert" role="alert" aria-live="assertive">
            {error}
          </div>
        ) : null}

        <div className="podium-action-row">
          <button className="auth-button secondary" type="button" onClick={handleSignOut} disabled={loading}>
            <Power size={16} />
            {loading ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}
