import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, LogIn, Power, ShieldCheck, Upload, Cast, Zap, FileStack } from "lucide-react";

import { authClient, getAuthErrorMessage, getDisplayRole, mainPanelAuthUrl, setSavedMainPanelUrl } from "./lib/auth";
import { translations, LANG_STORAGE_KEY } from "./lib/i18n";
import { WebSocketClient } from "./websocket/WebSocketClient";
import { IpcPresentationController } from "./presentation/IpcPresentationController";

function getDefaultWsUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  if (mainPanelAuthUrl) {
    try {
      const panelUrl = new URL(mainPanelAuthUrl);
      const wsProto = panelUrl.protocol === "https:" ? "wss:" : "ws:";
      if (panelUrl.port) {
        return `${wsProto}//${panelUrl.host}`;
      }
      return `${wsProto}//${panelUrl.hostname}:4001`;
    } catch {}
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `ws://${host}:4001`;
    }
  }

  return "ws://localhost:4001";
}

const wsUrl = getDefaultWsUrl().replace(/\/+$/, "");

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
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_STORAGE_KEY) || "ja");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadedItems, setUploadedItems] = useState([]);
  const [openingFile, setOpeningFile] = useState(false);

  const [events, setEvents] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]);
  const [displayEventId, setDisplayEventId] = useState("");
  const [displaySessionId, setDisplaySessionId] = useState("");
  const [displayState, setDisplayState] = useState("disconnected");
  const wsClientRef = useRef(null);
  const connectTimeoutRef = useRef(null);

  const [sessionFiles, setSessionFiles] = useState([]);
  const [sessionFilesLoading, setSessionFilesLoading] = useState(false);
  const [renamingFileId, setRenamingFileId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [coverText, setCoverText] = useState("");
  const [addingCover, setAddingCover] = useState(false);

  const user = session.data?.user ?? null;
  const t = translations[lang];
  const statusText = (key) => (key === "signIn" ? t.signIn : key === "twoFactorRequired" ? t.twoFactorRequired : "");

  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

  const setNotificationMessage = (type, message) => {
    setNotification({ type, message });
  };

  const clearConnectTimeout = () => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
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
      .then((data) => {
        const list = data.liveSessions ?? [];
        setLiveSessions(list);
        // Most events only have one session (auto-created with the
        // event), so auto-select it instead of forcing a second manual
        // picker when there's nothing to actually choose between.
        setDisplaySessionId((current) =>
          list.some((s) => s.id === current) ? current : (list[0]?.id ?? ""),
        );
      })
      .catch(() => setLiveSessions([]));
  }, [displayEventId]);

  useEffect(() => {
    return () => {
      clearConnectTimeout();
      wsClientRef.current?.disconnect();
    };
  }, []);

  const fetchSessionFiles = () => {
    if (!displaySessionId) {
      setSessionFiles([]);
      return;
    }
    setSessionFilesLoading(true);
    fetch(`${mainPanelAuthUrl}/api/live-sessions/${displaySessionId}/files`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setSessionFiles(data.files ?? []))
      .catch(() => setSessionFiles([]))
      .finally(() => setSessionFilesLoading(false));
  };

  useEffect(() => {
    fetchSessionFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySessionId]);

  const role = user?.role;
  const canUploadFiles = role === "admin" || role === "reviewer";
  const canDeleteFiles = role === "admin" || role === "reviewer";
  const canRenameFiles = role === "admin";
  const canReorderFiles = role === "admin" || role === "reviewer" || role === "presenter";

  const handleSessionFileUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !displaySessionId) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${mainPanelAuthUrl}/api/live-sessions/${displaySessionId}/files`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotificationMessage("error", payload.error || t.notif.uploadFailedFor(file.name));
        return;
      }
      setNotificationMessage("success", t.notif.filesUploaded(1));
      fetchSessionFiles();
    } catch (uploadError) {
      setNotificationMessage("error", getAuthErrorMessage(uploadError, t.notif.uploadFailedFor(file.name)));
    } finally {
      setUploading(false);
    }
  };

  const handleAddSessionCover = async () => {
    if (!coverText.trim() || !displaySessionId) return;
    setAddingCover(true);
    try {
      const response = await fetch(`${mainPanelAuthUrl}/api/live-sessions/${displaySessionId}/files/cover`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverText: coverText.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotificationMessage("error", payload.error || "Failed to add cover slide.");
        return;
      }
      setCoverText("");
      fetchSessionFiles();
    } catch (coverError) {
      setNotificationMessage("error", getAuthErrorMessage(coverError, "Failed to add cover slide."));
    } finally {
      setAddingCover(false);
    }
  };

  const handleSessionFileDelete = async (fileId) => {
    if (!window.confirm(t.deleteConfirm)) return;
    try {
      const response = await fetch(`${mainPanelAuthUrl}/api/live-sessions/${displaySessionId}/files/${fileId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setNotificationMessage("error", payload.error || t.notif.uploadFailed);
        return;
      }
      fetchSessionFiles();
    } catch (deleteError) {
      setNotificationMessage("error", getAuthErrorMessage(deleteError, t.notif.uploadFailed));
    }
  };

  const handleSessionFileRenameSubmit = async (file) => {
    if (!renameValue.trim()) return;
    try {
      const response = await fetch(`${mainPanelAuthUrl}/api/live-sessions/${displaySessionId}/files/${file.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          file.itemType === "cover" ? { coverText: renameValue.trim() } : { fileName: renameValue.trim() },
        ),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setNotificationMessage("error", payload.error || "Rename failed.");
        return;
      }
      setRenamingFileId(null);
      fetchSessionFiles();
    } catch (renameError) {
      setNotificationMessage("error", getAuthErrorMessage(renameError, "Rename failed."));
    }
  };

  const persistSessionFileOrder = async (nextFiles) => {
    setSessionFiles(nextFiles);
    try {
      const response = await fetch(`${mainPanelAuthUrl}/api/live-sessions/${displaySessionId}/files/reorder`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: nextFiles.map((f) => f.id) }),
      });
      if (!response.ok) throw new Error("Reorder failed.");
    } catch (reorderError) {
      setNotificationMessage("error", getAuthErrorMessage(reorderError, "Reorder failed."));
      fetchSessionFiles();
    }
  };

  const moveSessionFile = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= sessionFiles.length) return;
    const next = [...sessionFiles];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    void persistSessionFileOrder(next);
  };

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
        {
          // Only flip to "connected" once the server actually confirms the
          // auth handshake -- calling connect() merely opens the socket, it
          // doesn't guarantee the server accepted it (bad/expired token,
          // wrong signature, etc. all fail silently otherwise, leaving the
          // UI stuck showing "connected" while operator commands have
          // nowhere to go).
          onAuthSuccess: () => {
            clearConnectTimeout();
            setDisplayState("connected");
            setNotificationMessage("success", t.notif.connectedAsDisplay);
          },
          onAuthError: (code, message) => {
            clearConnectTimeout();
            setDisplayState("error");
            setNotificationMessage("error", `${t.notif.failedToConnect}: ${message} (${code})`);
            wsClientRef.current?.disconnect();
            wsClientRef.current = null;
          },
          onClose: () => {
            clearConnectTimeout();
            setDisplayState((prev) => (prev === "connected" || prev === "connecting" ? "disconnected" : prev));
          },
          onSocketError: () => {
            clearConnectTimeout();
            setDisplayState("error");
          },
        },
      );
      wsClientRef.current = client;
      client.connect();
      clearConnectTimeout();
      connectTimeoutRef.current = window.setTimeout(() => {
        if (wsClientRef.current === client) {
          wsClientRef.current?.disconnect();
          wsClientRef.current = null;
          setDisplayState("error");
          setNotificationMessage("error", `${t.notif.failedToConnect}: WebSocket timeout (${wsUrl})`);
        }
      }, 12000);
    } catch (err) {
      clearConnectTimeout();
      setDisplayState("error");
      setNotificationMessage("error", getAuthErrorMessage(err, t.notif.failedToConnect));
    }
  };

  const handleDisconnectDisplay = () => {
    clearConnectTimeout();
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
              <div className="podium-badge">
                <span className="podium-badge-icon">
                  <Zap size={18} fill="currentColor" />
                </span>
                <span className="podium-badge-text">
                  <span className="podium-badge-title">EventHQ</span>
                  <span className="podium-badge-sub">{t.brandSub}</span>
                </span>
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

            <div className="server-select-wrap" style={{ marginTop: 20 }}>
              <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>
                {t.server}:
              </label>
              <select
                aria-label="Select Server Backend"
                value={mainPanelAuthUrl}
                onChange={(e) => setSavedMainPanelUrl(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  color: "#fff",
                  padding: "7px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  outline: "none",
                  cursor: "pointer",
                  width: "100%",
                  maxWidth: "340px",
                }}
              >
                <option value="http://localhost:3000" style={{ background: "#0B1220", color: "#fff" }}>
                  Local Dev (http://localhost:3000)
                </option>
                <option value="https://conference.devorbit.cloud" style={{ background: "#0B1220", color: "#fff" }}>
                  AWS Cloud (https://conference.devorbit.cloud)
                </option>
              </select>
            </div>
          </section>

          <section className="login-panel">
            <div className="login-card">
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
            </div>
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
          <div className="podium-badge">
            <span className="podium-badge-icon">
              <Zap size={16} fill="currentColor" />
            </span>
            <span className="podium-badge-text">
              <span className="podium-badge-title">{t.dashboard}</span>
              <span className="podium-badge-sub">EventHQ</span>
            </span>
          </div>
          <div className="dashboard-header-right">
            <div className="lang-chip" style={{ borderColor: "var(--border-soft)", background: "var(--bg-page)" }}>
              <span
                className={lang === "en" ? "active" : ""}
                role="button"
                tabIndex={0}
                style={{ cursor: "pointer", color: lang === "en" ? undefined : "var(--text-muted)" }}
                onClick={() => setLang("en")}
              >
                EN
              </span>
              <span
                className={lang === "ja" ? "active" : ""}
                role="button"
                tabIndex={0}
                style={{ cursor: "pointer", color: lang === "ja" ? undefined : "var(--text-muted)" }}
                onClick={() => setLang("ja")}
              >
                JP
              </span>
            </div>
            <div className="user-chip">
              <span className="user-avatar">{(user.name || user.email || "?").slice(0, 1)}</span>
              <span className="user-chip-text">
                <span className="user-chip-email">{user.name || user.email}</span>
                <span className="user-chip-role">{t.roles?.[role?.toLowerCase()] || getDisplayRole(role)}</span>
              </span>
            </div>
            <button
              className="icon-btn"
              type="button"
              onClick={handleSignOut}
              disabled={loading}
              title={loading ? t.signingOut : t.signOut}
              aria-label={loading ? t.signingOut : t.signOut}
            >
              <Power size={16} />
            </button>
          </div>
        </header>

        <main className="dashboard-content">

          <section className="upload-panel">
            <div className="upload-header">
              <span className="upload-header-icon">
                <Cast size={18} />
              </span>
              <div className="upload-header-text">
                <h2>{t.connectAsDisplay}</h2>
                <p>{t.connectAsDisplayDesc}</p>
              </div>
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
                style={{ display: liveSessions.length > 1 ? undefined : "none" }}
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
              <span className={`status-pill ${displayState}`}>{t.displayStatus[displayState] ?? displayState}</span>
            </div>
          </section>

          <section className="upload-panel">
            <div className="upload-header">
              <span className="upload-header-icon blue">
                <FileStack size={18} />
              </span>
              <div className="upload-header-text">
                <h2>{t.sessionFilesTitle}</h2>
                <p>
                  {t.sessionFilesDesc}
                  {!canUploadFiles && t.reorderViewRoleHint}
                </p>
              </div>
            </div>

            {!displaySessionId ? (
              <span className="upload-hint">{t.selectSessionHint}</span>
            ) : sessionFilesLoading ? (
              <span className="upload-hint">{t.loadingFiles}</span>
            ) : (
              <>
                {canUploadFiles && (
                  <div className="upload-actions" style={{ marginBottom: 12 }}>
                    <label htmlFor="session-file-input" className={`file-dropzone ${uploading ? "disabled" : ""}`}>
                      <input
                        id="session-file-input"
                        type="file"
                        accept=".pptx,.pptm,.ppt,.pdf"
                        disabled={uploading}
                        onChange={(event) => void handleSessionFileUpload(event)}
                        style={{ display: "none" }}
                      />
                      <Upload size={16} />
                      <span>{t.chooseFile}</span>
                    </label>
                    {uploading ? <span className="upload-hint">{t.uploading}</span> : null}
                  </div>
                )}

                {canUploadFiles && (
                  <div className="upload-actions" style={{ marginBottom: 12, gap: 6 }}>
                    <input
                      type="text"
                      value={coverText}
                      onChange={(e) => setCoverText(e.target.value)}
                      placeholder={t.addCoverSlidePlaceholder}
                      disabled={addingCover}
                      maxLength={200}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="item-action-btn"
                      disabled={addingCover || !coverText.trim()}
                      onClick={() => void handleAddSessionCover()}
                    >
                      {addingCover ? t.adding : t.addCover}
                    </button>
                  </div>
                )}

                {sessionFiles.length === 0 ? (
                  <span className="upload-hint">{t.noFilesForSession}</span>
                ) : (
                  <ul className="upload-list">
                    {sessionFiles.map((item, index) => (
                      <li key={item.id}>
                        <span className="upload-item-links">
                          {canReorderFiles && (
                            <span className="upload-item-actions" style={{ marginRight: 8 }}>
                              <button
                                type="button"
                                className="item-action-btn"
                                disabled={index === 0}
                                onClick={() => moveSessionFile(index, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="item-action-btn"
                                disabled={index === sessionFiles.length - 1}
                                onClick={() => moveSessionFile(index, 1)}
                              >
                                ↓
                              </button>
                            </span>
                          )}
                          {renamingFileId === item.id ? (
                            <>
                              <input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                style={{ marginRight: 6 }}
                              />
                              <button
                                type="button"
                                className="item-action-btn"
                                onClick={() => void handleSessionFileRenameSubmit(item)}
                              >
                                {t.save}
                              </button>
                              <button type="button" className="item-action-btn" onClick={() => setRenamingFileId(null)}>
                                {t.cancel}
                              </button>
                            </>
                          ) : item.itemType === "cover" ? (
                            <span className="upload-item-name">🖼 {t.cover}: {item.coverText ?? ""}</span>
                          ) : (
                            <span className="upload-item-name">{item.fileName ?? ""}</span>
                          )}
                          <span className="upload-item-actions">
                            {item.publicUrl && isPowerPointFile(item.fileName ?? "") ? (
                              <>
                                <button
                                  className="item-action-btn preview-btn"
                                  onClick={() => handlePreviewInWindow({ publicUrl: item.publicUrl, name: item.fileName })}
                                >
                                  {t.presentInWindow}
                                </button>
                                <button
                                  className="item-action-btn open-btn"
                                  disabled={openingFile}
                                  onClick={() => handleOpenInApp({ publicUrl: item.publicUrl, name: item.fileName })}
                                >
                                  {openingFile ? t.opening : t.openInPowerPoint}
                                </button>
                              </>
                            ) : item.publicUrl ? (
                              <a href={item.publicUrl} target="_blank" rel="noreferrer">{t.view}</a>
                            ) : null}
                            {canRenameFiles && renamingFileId !== item.id && (
                              <button
                                type="button"
                                className="item-action-btn"
                                onClick={() => {
                                  setRenamingFileId(item.id);
                                  setRenameValue((item.itemType === "cover" ? item.coverText : item.fileName) ?? "");
                                }}
                              >
                                {t.rename}
                              </button>
                            )}
                            {canDeleteFiles && (
                              <button
                                type="button"
                                className="item-action-btn"
                                onClick={() => void handleSessionFileDelete(item.id)}
                              >
                                {t.delete}
                              </button>
                            )}
                          </span>
                        </span>
                        <span>
                          {item.itemType === "cover" ? t.coverSlide : formatBytes(item.fileSize ?? 0)} · {t.uploadedBy(item.uploadedBy)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="upload-panel">
            <div className="upload-header">
              <span className="upload-header-icon violet">
                <Upload size={18} />
              </span>
              <div className="upload-header-text">
                <h2>{t.uploadMaterials}</h2>
                <p>{t.uploadMaterialsDesc}</p>
              </div>
            </div>

            <label
              htmlFor="materials-file-input"
              className={`file-dropzone ${uploading ? "disabled" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (uploading) return;
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length > 0) {
                  setSelectedFiles(files);
                }
              }}
            >
              <input
                id="materials-file-input"
                type="file"
                multiple
                accept=".pptx,.pptm,.ppt,.pdf"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  setSelectedFiles(files);
                }}
                disabled={uploading}
                style={{ display: "none" }}
              />
              <Upload size={18} />
              <span>{selectedFiles.length > 0 ? t.filesSelected(selectedFiles.length) : t.chooseFiles}</span>
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
