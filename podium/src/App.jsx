import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, LogIn, Power, ShieldCheck, Upload } from "lucide-react";

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

export default function App() {
  const session = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaStep, setIsMfaStep] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Sign in");
  const [notification, setNotification] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadedItems, setUploadedItems] = useState([]);
  const [openingFile, setOpeningFile] = useState(false);

  const user = session.data?.user ?? null;

  const setNotificationMessage = (type, message) => {
    setNotification({ type, message });
  };

  useEffect(() => {
    if (!notification) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotification(null);
    }, 4500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notification]);

  useEffect(() => {
    if (session.isPending) {
      return;
    }

    if (user) {
      setStatus("");
      setIsMfaStep(false);
      setError("");
      return;
    }

    setStatus("Sign in");
  }, [session.isPending, user]);

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
        const message = getAuthErrorMessage(result.error, "Invalid credentials.");
        setError(message);
        setNotificationMessage("error", message);
        return;
      }

      if (result.data && (result.data.twoFactorRedirect || result.data.twoFactorMethods?.length)) {
        setIsMfaStep(true);
        setStatus("Two-factor required");
        setNotificationMessage("warning", "Enter your verification code.");
        return;
      }

      await session.refetch();
      setNotificationMessage("success", "Signed in.");
    } catch (signInError) {
      const message = getAuthErrorMessage(signInError, "Unable to sign in.");
      setError(message);
      setNotificationMessage("error", message);
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
        const message = getAuthErrorMessage(result.error, "Verification failed.");
        setError(message);
        setNotificationMessage("error", message);
        return;
      }

      setMfaCode("");
      setIsMfaStep(false);
      await session.refetch();
      setNotificationMessage("success", "Verification complete.");
    } catch (verifyError) {
      const message = getAuthErrorMessage(verifyError, "Verification failed.");
      setError(message);
      setNotificationMessage("error", message);
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
      setNotificationMessage("success", "Signed out.");
    } catch (signOutError) {
      const message = getAuthErrorMessage(signOutError, "Unable to sign out.");
      setError(message);
      setNotificationMessage("error", message);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getPreviewUrl = (item) => {
    if (!item.publicUrl) return "";
    const name = (item.name || "").toLowerCase();
    const isPowerPoint =
      name.endsWith(".ppt") ||
      name.endsWith(".pptx") ||
      name.endsWith(".pps") ||
      name.endsWith(".ppsx") ||
      name.endsWith(".pptm");

    if (!isPowerPoint) return item.publicUrl;

    // Google Docs viewer is more reliable than Office Online for S3 public URLs
    return `https://docs.google.com/gview?url=${encodeURIComponent(item.publicUrl)}&embedded=true`;
  };

  const isPowerPointFile = (name) => {
    const lower = (name || "").toLowerCase();
    return (
      lower.endsWith(".ppt") ||
      lower.endsWith(".pptx") ||
      lower.endsWith(".pps") ||
      lower.endsWith(".ppsx") ||
      lower.endsWith(".pptm")
    );
  };

  const isElectron = Boolean(window.electronAPI?.openFileForPresentation);

  const handleOpenInApp = async (item) => {
    if (!isElectron) {
      // Fallback: try ms-powerpoint URI scheme (works if PowerPoint is installed)
      window.location.href = `ms-powerpoint:ofe|u|${item.publicUrl}`;
      setNotificationMessage("warning", "Trying to open in PowerPoint via protocol link…");
      return;
    }
    setOpeningFile(true);
    try {
      const result = await window.electronAPI.openFileForPresentation(item.publicUrl, item.name);
      if (!result || !result.success) {
        setNotificationMessage("error", result?.error || "Could not open file.");
      } else {
        setNotificationMessage("success", `Opening ${item.name} in PowerPoint…`);
      }
    } catch (err) {
      setNotificationMessage("error", `Failed: ${err?.message ?? "unknown error"}`);
    } finally {
      setOpeningFile(false);
    }
  };

  const handlePreviewInWindow = async (item) => {
    if (!isElectron) {
      const viewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(item.publicUrl)}`;
      window.open(viewerUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const result = await window.electronAPI.openPresentationWindow(item.publicUrl, item.name);
      if (!result || !result.success) {
        setNotificationMessage("error", "Could not open presentation window.");
      }
    } catch (err) {
      setNotificationMessage("error", `Failed: ${err?.message ?? "unknown error"}`);
    }
  };

  const handleUploadMaterials = async () => {
    if (selectedFiles.length === 0) {
      setNotificationMessage("warning", "Select files first.");
      return;
    }

    setUploading(true);
    setError("");

    let uploadedCount = 0;
    let failedCount = 0;
    const nextUploaded = [];

    for (const file of selectedFiles) {
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`${mainPanelAuthUrl}/api/uploads`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          failedCount += 1;
          setError(payload.error || `Upload failed for ${file.name}`);
          continue;
        }

        uploadedCount += 1;
        nextUploaded.push({
          name: file.name,
          size: file.size,
          objectKey: payload.objectKey || "-",
          publicUrl: payload.publicUrl || "",
        });
      } catch (uploadError) {
        failedCount += 1;
        setError(getAuthErrorMessage(uploadError, `Upload failed for ${file.name}`));
      }
    }

    if (nextUploaded.length > 0) {
      setUploadedItems((prev) => [...nextUploaded, ...prev].slice(0, 12));
      setSelectedFiles([]);
    }

    if (uploadedCount > 0 && failedCount === 0) {
      setNotificationMessage("success", `${uploadedCount} file(s) uploaded.`);
    } else if (uploadedCount > 0 && failedCount > 0) {
      setNotificationMessage("warning", `${uploadedCount} uploaded, ${failedCount} failed.`);
    } else if (failedCount > 0) {
      setNotificationMessage("error", "Upload failed.");
    }

    setUploading(false);
  };

  const notificationIcon =
    notification?.type === "success"
      ? <CheckCircle2 size={16} />
      : notification?.type === "warning"
        ? <AlertTriangle size={16} />
        : <XCircle size={16} />;

  if (!user) {
    return (
      <div className="podium-shell">
        {notification ? (
          <div className={`podium-toast ${notification.type}`} role="status" aria-live="polite">
            {notificationIcon}
            <span>{notification.message}</span>
          </div>
        ) : null}
        <div className="login-layout">
          <section className="hero-panel">
            <div className="hero-top">
              <div className="brand-block">
                <div className="podium-badge">
                  <ShieldCheck size={16} />
                  EventHQ
                </div>
                <p className="hero-brand-sub">EVENTHQ PLATFORM</p>
              </div>
              <div className="lang-chip">
                <span className="active">EN</span>
                <span>JP</span>
              </div>
            </div>

            <h1 className="hero-title">Seamless reception for your events</h1>
            <p className="hero-subtitle">
            Presentations can be presented
            </p>

            <p className="server-note">Server: {mainPanelAuthUrl}</p>
          </section>

          <section className="login-panel">
            <div className="podium-auth-header">
              <h1 className="podium-title">Welcome back</h1>
              
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
                  placeholder="Password"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button className="auth-button" type="submit" disabled={loading}>
                  <LogIn size={16} />
                  {loading ? "Signing in..." : "Login"}
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
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="podium-shell">
      {notification ? (
        <div className={`podium-toast ${notification.type}`} role="status" aria-live="polite">
          {notificationIcon}
          <span>{notification.message}</span>
        </div>
      ) : null}
      <div className="dashboard-layout">
        <header className="dashboard-header">
          <div>
            <div className="podium-badge">
              <ShieldCheck size={16} />
              EventHQ
            </div>
            <h1 className="dashboard-title"> Dashboard</h1>
          </div>
          <button className="auth-button secondary" type="button" onClick={handleSignOut} disabled={loading}>
            <Power size={16} />
            {loading ? "Signing out..." : "Sign out"}
          </button>
        </header>

        <main className="dashboard-content">
        

          <section className="upload-panel">
            <div className="upload-header">
              <h2>Upload materials</h2>
              <p>Select files from local disk, USB, or external drives.</p>
            </div>

            <label className="file-picker">
              <input
                type="file"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  setSelectedFiles(files);
                }}
                disabled={uploading}
              />
            </label>

            <div className="upload-actions">
              <button
                className="auth-button"
                type="button"
                onClick={handleUploadMaterials}
                disabled={uploading || selectedFiles.length === 0}
              >
                <Upload size={16} />
                {uploading ? "Uploading..." : "Upload to server"}
              </button>
              {selectedFiles.length > 0 ? (
                <span className="upload-hint">{selectedFiles.length} file(s) selected</span>
              ) : null}
            </div>

            {uploadedItems.length > 0 ? (
              <ul className="upload-list">
                {uploadedItems.map((item) => (
                  <li key={`${item.objectKey}-${item.name}`}>
                    <span className="upload-item-links">
                     <span className="upload-item-name">{item.name}</span>
                     <span className="upload-item-actions">
                       {item.publicUrl && isPowerPointFile(item.name) ? (
                         <>
                           <button
                             className="item-action-btn preview-btn"
                             onClick={() => handlePreviewInWindow(item)}
                           >
                              Present in window
                           </button>
                           <button
                             className="item-action-btn open-btn"
                             disabled={openingFile}
                             onClick={() => handleOpenInApp(item)}
                           >
                             {openingFile ? "Opening…" : "⬆ Open in PowerPoint"}
                           </button>
                         </>
                       ) : item.publicUrl ? (
                         <a href={item.publicUrl} target="_blank" rel="noreferrer">View</a>
                       ) : null}
                     </span>
                   </span>
                   <span>{formatBytes(item.size)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="podium-status-copy">{status}</div>
          {error ? (
            <div className="podium-alert" role="alert" aria-live="assertive">
              {error}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
