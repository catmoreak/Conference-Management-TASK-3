import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, LogIn, Power, ShieldCheck, Upload, Cast } from "lucide-react";

import { authClient, getAuthErrorMessage, getDisplayRole, mainPanelAuthUrl } from "./lib/auth";
import { translations, LANG_STORAGE_KEY } from "./lib/i18n";
import { WebSocketClient } from "./websocket/WebSocketClient";
import { IpcPresentationController } from "./presentation/IpcPresentationController";

const wsUrl = (import.meta.env.VITE_WS_URL ?? "ws://localhost:4001").replace(/\/+$/, "");

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
  const [statusKey, setStatusKey] = useState("signIn");
  const [notification, setNotification] = useState(null);
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_STORAGE_KEY) || "en");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadedItems, setUploadedItems] = useState([]);
  const [openingFile, setOpeningFile] = useState(false);

  const [events, setEvents] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]);
  const [displayEventId, setDisplayEventId] = useState("");
  const [displaySessionId, setDisplaySessionId] = useState("");
  const [displayState, setDisplayState] = useState("disconnected");
  const wsClientRef = useRef(null);

  const user = session.data?.user ?? null;
  const t = translations[lang];
  const statusText = (key) => (key === "signIn" ? t.signIn : key === "twoFactorRequired" ? t.twoFactorRequired : "");

  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

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
      setStatusKey("");
      setIsMfaStep(false);
      setError("");
      return;
    }

    setStatusKey("signIn");
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
        const message = getAuthErrorMessage(result.error, t.notif.invalidCredentials);
        setError(message);
        setNotificationMessage("error", message);
        return;
      }

      if (result.data && (result.data.twoFactorRedirect || result.data.twoFactorMethods?.length)) {
        setIsMfaStep(true);
        setStatusKey("twoFactorRequired");
        setNotificationMessage("warning", t.notif.enterVerificationCode);
        return;
      }

      await session.refetch();
      setNotificationMessage("success", t.notif.signedIn);
    } catch (signInError) {
      const message = getAuthErrorMessage(signInError, t.notif.unableToSignIn);
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
        const message = getAuthErrorMessage(result.error, t.notif.verificationFailed);
        setError(message);
        setNotificationMessage("error", message);
        return;
      }

      setMfaCode("");
      setIsMfaStep(false);
      await session.refetch();
      setNotificationMessage("success", t.notif.verificationComplete);
    } catch (verifyError) {
      const message = getAuthErrorMessage(verifyError, t.notif.verificationFailed);
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
      setNotificationMessage("success", t.notif.signedOut);
    } catch (signOutError) {
      const message = getAuthErrorMessage(signOutError, t.notif.unableToSignOut);
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
      setNotificationMessage("warning", t.notif.tryingProtocolLink);
      return;
    }
    setOpeningFile(true);
    try {
      const result = await window.electronAPI.openFileForPresentation(item.publicUrl, item.name);
      if (!result || !result.success) {
        setNotificationMessage("error", result?.error || t.notif.couldNotOpenFile);
      } else {
        setNotificationMessage("success", t.notif.openingInPowerPoint(item.name));
      }
    } catch (err) {
      setNotificationMessage("error", `${t.notif.failedPrefix}${err?.message ?? t.notif.unknownError}`);
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
        setNotificationMessage("error", t.notif.couldNotOpenWindow);
      }
    } catch (err) {
      setNotificationMessage("error", `${t.notif.failedPrefix}${err?.message ?? t.notif.unknownError}`);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetch(`${mainPanelAuthUrl}/api/checkin`)
      .then((r) => r.json())
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setEvents([]));
  }, [user]);

  useEffect(() => {
    if (!displayEventId) {
      setLiveSessions([]);
      return;
    }
    fetch(`${mainPanelAuthUrl}/api/live-sessions?eventId=${displayEventId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setLiveSessions(data.liveSessions ?? []))
      .catch(() => setLiveSessions([]));
  }, [displayEventId]);

  useEffect(() => {
    return () => {
      wsClientRef.current?.disconnect();
    };
  }, []);

  const handleConnectDisplay = async () => {
    if (!displaySessionId || !user) return;
    setDisplayState("connecting");

    try {
      const res = await fetch(`${mainPanelAuthUrl}/api/ws/token`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveSessionId: displaySessionId, purpose: "display" }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setDisplayState("error");
        setNotificationMessage("error", data.error || t.notif.failedToGetDisplayToken);
        return;
      }

      const controller = new IpcPresentationController(displaySessionId);
      const client = new WebSocketClient(
        `${wsUrl}?liveSessionId=${displaySessionId}`,
        user.id,
        data.token,
        controller,
      );
      wsClientRef.current = client;
      client.connect();
      setDisplayState("connected");
      setNotificationMessage("success", t.notif.connectedAsDisplay);
    } catch (err) {
      setDisplayState("error");
      setNotificationMessage("error", getAuthErrorMessage(err, t.notif.failedToConnect));
    }
  };

  const handleDisconnectDisplay = () => {
    wsClientRef.current?.disconnect();
    wsClientRef.current = null;
    setDisplayState("disconnected");
  };

  const handleUploadMaterials = async () => {
    if (selectedFiles.length === 0) {
      setNotificationMessage("warning", t.notif.selectFilesFirst);
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
          setError(payload.error || t.notif.uploadFailedFor(file.name));
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
        setError(getAuthErrorMessage(uploadError, t.notif.uploadFailedFor(file.name)));
      }
    }

    if (nextUploaded.length > 0) {
      setUploadedItems((prev) => [...nextUploaded, ...prev].slice(0, 12));
      setSelectedFiles([]);
    }

    if (uploadedCount > 0 && failedCount === 0) {
      setNotificationMessage("success", t.notif.filesUploaded(uploadedCount));
    } else if (uploadedCount > 0 && failedCount > 0) {
      setNotificationMessage("warning", t.notif.uploadedAndFailed(uploadedCount, failedCount));
    } else if (failedCount > 0) {
      setNotificationMessage("error", t.notif.uploadFailed);
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
                <p className="hero-brand-sub">{t.brandSub}</p>
              </div>
              <div className="lang-chip">
                <span
                  className={lang === "en" ? "active" : ""}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  onClick={() => setLang("en")}
                >
                  EN
                </span>
                <span
                  className={lang === "ja" ? "active" : ""}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  onClick={() => setLang("ja")}
                >
                  JP
                </span>
              </div>
            </div>

            <h1 className="hero-title">{t.heroTitle}</h1>
            <p className="hero-subtitle">
            {t.heroSubtitle}
            </p>

            <p className="server-note">{t.server}: {mainPanelAuthUrl}</p>
          </section>

          <section className="login-panel">
            <div className="podium-auth-header">
              <h1 className="podium-title">{t.welcomeBack}</h1>

            </div>

            {error ? (
              <div className="podium-alert" role="alert" aria-live="assertive">
                {error}
              </div>
            ) : (
              <div className="podium-status-copy">{statusText(statusKey)}</div>
            )}

            {!isMfaStep ? (
              <form className="auth-form" onSubmit={handleSignIn}>
                <AuthField
                  label={t.email}
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t.emailPlaceholder}
                  autoComplete="email"
                  disabled={loading}
                />
                <AuthField
                  label={t.password}
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t.passwordPlaceholder}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button className="auth-button" type="submit" disabled={loading}>
                  <LogIn size={16} />
                  {loading ? t.signingIn : t.login}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleVerifyTotp}>
                <AuthField
                  label={t.verificationCode}
                  id="mfaCode"
                  type="text"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  placeholder={t.codePlaceholder}
                  autoComplete="one-time-code"
                  disabled={loading}
                />
                <button className="auth-button" type="submit" disabled={loading}>
                  <ShieldCheck size={16} />
                  {loading ? t.verifying : t.verifyCode}
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
            <h1 className="dashboard-title">{t.dashboard}</h1>
          </div>
          <button className="auth-button secondary" type="button" onClick={handleSignOut} disabled={loading}>
            <Power size={16} />
            {loading ? t.signingOut : t.signOut}
          </button>
        </header>

        <main className="dashboard-content">

          <section className="upload-panel">
            <div className="upload-header">
              <h2><Cast size={16} style={{ display: "inline", marginRight: 6 }} />{t.connectAsDisplay}</h2>
              <p>{t.connectAsDisplayDesc}</p>
            </div>

            <div className="upload-actions" style={{ flexWrap: "wrap" }}>
              <select
                value={displayEventId}
                onChange={(e) => {
                  setDisplayEventId(e.target.value);
                  setDisplaySessionId("");
                }}
                disabled={displayState === "connected"}
              >
                <option value="">{t.selectEvent}</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.name}</option>
                ))}
              </select>
              <select
                value={displaySessionId}
                onChange={(e) => setDisplaySessionId(e.target.value)}
                disabled={!displayEventId || displayState === "connected"}
              >
                <option value="">{t.selectLiveSession}</option>
                {liveSessions.map((ls) => (
                  <option key={ls.id} value={ls.id}>{ls.name}{ls.room ? ` (${ls.room.name})` : ""}</option>
                ))}
              </select>
              {displayState === "connected" ? (
                <button className="auth-button secondary" type="button" onClick={handleDisconnectDisplay}>
                  {t.disconnect}
                </button>
              ) : (
                <button
                  className="auth-button"
                  type="button"
                  disabled={!displaySessionId || displayState === "connecting"}
                  onClick={() => void handleConnectDisplay()}
                >
                  {displayState === "connecting" ? t.connecting : t.connect}
                </button>
              )}
              <span className="upload-hint">{t.displayStatus[displayState] ?? displayState}</span>
            </div>
          </section>

          <section className="upload-panel">
            <div className="upload-header">
              <h2>{t.uploadMaterials}</h2>
              <p>{t.uploadMaterialsDesc}</p>
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
                {uploading ? t.uploading : t.uploadToServer}
              </button>
              {selectedFiles.length > 0 ? (
                <span className="upload-hint">{t.filesSelected(selectedFiles.length)}</span>
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
                              {t.presentInWindow}
                           </button>
                           <button
                             className="item-action-btn open-btn"
                             disabled={openingFile}
                             onClick={() => handleOpenInApp(item)}
                           >
                             {openingFile ? t.opening : t.openInPowerPoint}
                           </button>
                         </>
                       ) : item.publicUrl ? (
                         <a href={item.publicUrl} target="_blank" rel="noreferrer">{t.view}</a>
                       ) : null}
                     </span>
                   </span>
                   <span>{formatBytes(item.size)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="podium-status-copy">{statusText(statusKey)}</div>
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
