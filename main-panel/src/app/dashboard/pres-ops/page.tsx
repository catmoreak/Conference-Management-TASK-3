"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";
import { env } from "~/env";

type ConnState = "disconnected" | "connecting" | "connected" | "locked" | "error";

export default function PresOpsDashboard() {
  const { user, signOut } = useAuth();
  const [eventId, setEventId] = useState("");
  const [liveSessionId, setLiveSessionId] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [connState, setConnState] = useState<ConnState>("disconnected");
  const [log, setLog] = useState<string[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const { data: events } = api.event.list.useQuery();
  const { data: sessions } = api.liveSession.listByEvent.useQuery(
    { eventId },
    { enabled: !!eventId },
  );
  const { data: submissions } = api.submission.listApprovedForSession.useQuery(
    { liveSessionId },
    { enabled: !!liveSessionId },
  );

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  function appendLog(line: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30));
  }

  async function handleConnect() {
    if (!liveSessionId) return;
    setConnState("connecting");

    const res = await fetch("/api/ws/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liveSessionId, purpose: "control" }),
    });
    const data = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !data.token) {
      appendLog(`Failed to get control token: ${data.error ?? res.status}`);
      setConnState("error");
      return;
    }

    const wsUrl = `${env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001"}?liveSessionId=${liveSessionId}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      // actorType/serviceId only match the shared PodiumAuthHandshake wire
      // shape (see scripts/ws-server.ts) so this operator connection looks
      // identical on the wire to podium's own WebSocketClient -- the server
      // never trusts these client-asserted fields. Purpose ("control") and
      // role come solely from the verified JWT minted by /api/ws/token.
      socket.send(
        JSON.stringify({
          type: "auth",
          actorType: "service",
          serviceId: user?.id ?? "operator",
          token: data.token,
        }),
      );
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg.type === "error" && msg.code === "control_locked") {
          setConnState("locked");
          appendLog("Another operator already controls this session.");
          return;
        }
        if (msg.type === "status" && msg.status === "connected") {
          setConnState("connected");
        }
        appendLog(`recv: ${JSON.stringify(msg)}`);
      } catch {
        // ignore unparsable frames
      }
    });

    socket.addEventListener("close", () => {
      setConnState("disconnected");
      appendLog("Disconnected.");
    });

    socket.addEventListener("error", () => {
      setConnState("error");
      appendLog("WebSocket error.");
    });
  }

  function handleDisconnect() {
    socketRef.current?.close();
    socketRef.current = null;
  }

  function sendCommand(command: Record<string, unknown>) {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      appendLog("Not connected.");
      return;
    }
    socket.send(JSON.stringify({ sessionId: liveSessionId, ...command }));
    appendLog(`sent: ${command.type as string}`);
  }

  const selectedSubmission = (submissions ?? []).find((s) => s.id === submissionId);
  const canOperate = connState === "connected";

  async function handleLoad() {
    if (!selectedSubmission) return;
    setLoadingFile(true);
    try {
      // Fetched fresh right before use -- short-lived presigned URL
      // (300s TTL), not the submission's old permanent public link.
      const res = await fetch(`/api/submissions/${selectedSubmission.id}/playback-url`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        appendLog(`Failed to get playback URL: ${data.error ?? res.status}`);
        return;
      }
      sendCommand({
        type: "load_presentation",
        presentationId: selectedSubmission.id,
        fileUrl: data.url,
      });
    } finally {
      setLoadingFile(false);
    }
  }

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Live Control</h1>
            <p className="text-text-secondary text-sm mt-1">
              Connect to a live session and drive the podium display in real time.
            </p>
          </div>
          <button
            onClick={() => void signOut()}
            className="bg-bg-secondary hover:bg-white text-text-primary border border-border-soft font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover"
          >
            Sign Out
          </button>
        </div>

        <div className="bg-bg-secondary border border-border-soft rounded-xl p-6 shadow-hard-lg space-y-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-select">
                Event
              </label>
              <select
                id="ev-select"
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setLiveSessionId("");
                  setSubmissionId("");
                }}
                className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none"
              >
                <option value="">— Select —</option>
                {(events ?? []).map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ls-select">
                Live Session
              </label>
              <select
                id="ls-select"
                value={liveSessionId}
                disabled={!eventId}
                onChange={(e) => {
                  setLiveSessionId(e.target.value);
                  setSubmissionId("");
                }}
                className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none disabled:opacity-50"
              >
                <option value="">— Select —</option>
                {(sessions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.room ? `(${s.room.name})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="sub-select">
                Approved File
              </label>
              <select
                id="sub-select"
                value={submissionId}
                disabled={!liveSessionId}
                onChange={(e) => setSubmissionId(e.target.value)}
                className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none disabled:opacity-50"
              >
                <option value="">— Select —</option>
                {(submissions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fileName ?? s.id} {s.presenter ? `— ${s.presenter.displayName}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border shadow-hard-sm ${
                connState === "connected"
                  ? "bg-success/10 text-success border-success/30"
                  : connState === "locked" || connState === "error"
                    ? "bg-error/10 text-error border-error/30"
                    : "bg-bg-primary text-text-secondary border-border-soft"
              }`}
            >
              {connState}
            </span>
            {connState === "connected" ? (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm"
              >
                Disconnect
              </button>
            ) : (
              <button
                disabled={!liveSessionId || connState === "connecting"}
                onClick={() => void handleConnect()}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition shadow-hard-sm disabled:opacity-50"
              >
                Connect
              </button>
            )}
          </div>
        </div>

        <div className="bg-bg-secondary border border-border-soft rounded-xl p-6 shadow-hard-lg mb-6">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4">Playback Controls</h2>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!canOperate || !selectedSubmission || loadingFile}
              onClick={() => void handleLoad()}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent-blue hover:bg-accent-blue/90 text-white transition shadow-hard hover:shadow-hard-hover disabled:opacity-50"
            >
              {loadingFile ? "Loading..." : "Load"}
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "play" })}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-bg-primary hover:bg-white text-text-primary border border-border-soft transition shadow-hard hover:shadow-hard-hover disabled:opacity-50"
            >
              Play
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "prev_slide" })}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-bg-primary hover:bg-white text-text-primary border border-border-soft transition shadow-hard hover:shadow-hard-hover disabled:opacity-50"
            >
              ← Prev
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "next_slide" })}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-bg-primary hover:bg-white text-text-primary border border-border-soft transition shadow-hard hover:shadow-hard-hover disabled:opacity-50"
            >
              Next →
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "exit_slideshow" })}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm disabled:opacity-50"
            >
              Exit
            </button>
          </div>
        </div>

        <div className="bg-bg-secondary border border-border-soft rounded-xl p-6 shadow-hard">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-3">Activity Log</h2>
          <div className="font-mono text-xs text-text-secondary space-y-1 max-h-56 overflow-y-auto">
            {log.length === 0 && <p className="text-text-muted">No activity yet.</p>}
            {log.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
