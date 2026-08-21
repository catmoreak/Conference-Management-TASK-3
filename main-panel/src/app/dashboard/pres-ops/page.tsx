"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useLanguage } from "~/app/_components/LanguageContext";
import { env } from "~/env";

type ConnState = "disconnected" | "connecting" | "connected" | "locked" | "error";

export default function PresOpsDashboard() {
  const { user, signOut } = useAuth();
  const { lang, t } = useLanguage();

  const [eventId, setEventId] = useState("");
  const [liveSessionId, setLiveSessionId] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [connState, setConnState] = useState<ConnState>("disconnected");
  const [displayConnected, setDisplayConnected] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const { data: events } = api.event.list.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: sessions } = api.liveSession.listByEvent.useQuery(
    { eventId },
    { enabled: !!eventId },
  );
  const { data: submissions, isLoading: submissionsLoading } = api.submission.listApprovedForSession.useQuery(
    { liveSessionId },
    { enabled: !!liveSessionId },
  );

  // Auto-select session when event is selected or sessions change
  useEffect(() => {
    if (!eventId) {
      setLiveSessionId("");
      return;
    }
    if (sessions && sessions.length > 0) {
      setLiveSessionId((current) =>
        sessions.some((s) => s.id === current) ? current : (sessions[0]?.id ?? ""),
      );
    }
  }, [eventId, sessions]);

  // Auto-select first approved presentation when session is selected or submissions load
  useEffect(() => {
    if (!liveSessionId) {
      setSubmissionId("");
      return;
    }
    if (submissions && submissions.length > 0) {
      setSubmissionId((current) =>
        submissions.some((s) => s.id === current) ? current : (submissions[0]?.id ?? ""),
      );
    }
  }, [liveSessionId, submissions]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  function appendLog(line: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30));
  }

  function formatBytes(bytes?: number | null): string {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatEventSchedule(startDate?: Date | string | null, endDate?: Date | string | null, lang: string = "ja"): string | null {
    if (!startDate && !endDate) return null;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const validStart = start && !isNaN(start.getTime()) ? start : null;
    const validEnd = end && !isNaN(end.getTime()) ? end : null;

    if (!validStart && !validEnd) return null;

    const locale = lang === "ja" ? "ja-JP" : "en-US";

    const dateOpts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: lang === "ja" ? "numeric" : "short",
      day: "numeric",
    };
    const timeOpts: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };

    if (validStart && validEnd) {
      const isSameDay = validStart.toDateString() === validEnd.toDateString();
      const startDateStr = validStart.toLocaleDateString(locale, dateOpts);
      const startTimeStr = validStart.toLocaleTimeString(locale, timeOpts);
      const endTimeStr = validEnd.toLocaleTimeString(locale, timeOpts);

      if (isSameDay) {
        return `${startDateStr} ${startTimeStr} – ${endTimeStr}`;
      } else {
        const endDateStr = validEnd.toLocaleDateString(locale, dateOpts);
        return `${startDateStr} ${startTimeStr} – ${endDateStr} ${endTimeStr}`;
      }
    }

    if (validStart) {
      return `${validStart.toLocaleDateString(locale, dateOpts)} ${validStart.toLocaleTimeString(locale, timeOpts)}`;
    }

    if (validEnd) {
      return `~ ${validEnd.toLocaleDateString(locale, dateOpts)} ${validEnd.toLocaleTimeString(locale, timeOpts)}`;
    }

    return null;
  }

  async function handleConnect() {
    if (!liveSessionId) return;
    setConnState("connecting");
    setDisplayConnected(false);

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

    const defaultWsHost =
      typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
        ? window.location.hostname
        : "localhost";
    const wsUrl = `${env.NEXT_PUBLIC_WS_URL ?? `ws://${defaultWsHost}:4001`}?liveSessionId=${liveSessionId}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
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
          appendLog(lang === "ja" ? "他のオペレーターがこのセッションを既に操作中です。" : "Another operator already controls this session.");
          return;
        }
        if (msg.type === "error" && msg.code === "no_display") {
          appendLog(
            lang === "ja"
              ? "ポディウムディスプレイが接続されていません。コマンドは送信されませんでした。"
              : "No podium display is connected — the command was not delivered.",
          );
          return;
        }
        if (msg.type === "status" && msg.status === "connected") {
          setConnState("connected");
          if (typeof msg.displayCount === "number") {
            setDisplayConnected(msg.displayCount > 0);
          }
        }
        if (msg.type === "status" && msg.status === "display_connected") {
          setDisplayConnected(true);
        }
        if (msg.type === "status" && msg.status === "display_disconnected") {
          setDisplayConnected(false);
        }
        appendLog(`recv: ${JSON.stringify(msg)}`);
      } catch {
        // ignore unparsable frames
      }
    });

    socket.addEventListener("close", () => {
      setConnState("disconnected");
      setDisplayConnected(false);
      appendLog(lang === "ja" ? "切断されました。" : "Disconnected.");
    });

    socket.addEventListener("error", () => {
      setConnState("error");
      appendLog(lang === "ja" ? "WebSocket エラー。" : "WebSocket error.");
    });
  }

  function handleDisconnect() {
    socketRef.current?.close();
    socketRef.current = null;
  }

  function sendCommand(command: Record<string, unknown>) {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      appendLog(lang === "ja" ? "未接続です。" : "Not connected.");
      return;
    }
    socket.send(JSON.stringify({ sessionId: liveSessionId, ...command }));
    appendLog(`sent: ${command.type as string}`);
  }

  const selectedSubmission = (submissions ?? []).find((s) => s.id === submissionId);
  const selectedEvent = (events ?? []).find((ev) => ev.id === eventId);
  const canOperate = connState === "connected" && displayConnected;

  async function handleLoad() {
    if (!selectedSubmission) return;
    await loadPresentationById(selectedSubmission.id);
  }

  async function loadPresentationById(targetId: string) {
    const target = (submissions ?? []).find((s) => s.id === targetId);
    if (!target) return;
    setSubmissionId(targetId);
    setLoadingFile(true);
    try {
      const sub = target as any;
      if (sub?.itemType === "cover") {
        sendCommand({
          type: "show_cover",
          presentationId: sub.id,
          text: sub.coverText ?? "",
        });
        return;
      }
      const res = await fetch(`/api/submissions/${target.id}/playback-url`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        appendLog(`Failed to get playback URL: ${data.error ?? res.status}`);
        return;
      }
      sendCommand({
        type: "load_presentation",
        presentationId: target.id,
        fileUrl: data.url,
      });
    } finally {
      setLoadingFile(false);
    }
  }

  const getConnStateLabel = (state: ConnState) => {
    if (lang === "ja") {
      switch (state) {
        case "connected": return "接続中";
        case "connecting": return "接続処理中...";
        case "disconnected": return "未接続";
        case "locked": return "ロック中";
        case "error": return "エラー";
      }
    }
    return state;
  };

  return (
    <div className="flex-1 bg-[#F8FAFC] text-text-secondary p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0B1220] tracking-tight">{t.presOpsDashboard.title}</h1>
            <p className="text-gray-500 text-xs mt-1">
              {t.presOpsDashboard.subTitle}
            </p>
          </div>
          <button
            onClick={() => void signOut()}
            className="self-end sm:self-auto bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 font-semibold px-4 py-2 rounded-xl text-xs sm:text-sm transition shadow-sm"
          >
            {t.signOut}
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm space-y-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2" htmlFor="ev-select">
                {lang === "ja" ? "イベント" : "Event"}
              </label>
              <select
                id="ev-select"
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setLiveSessionId("");
                  setSubmissionId("");
                }}
                className="w-full bg-white border border-gray-200 text-text-primary text-sm rounded-xl px-3 py-2.5 focus:border-[#0B1220] focus:ring-2 focus:ring-[#0B1220]/10 outline-none transition"
              >
                <option value="">{t.actions.select}</option>
                {(events ?? []).map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2" htmlFor="ls-select">
                {t.presOpsDashboard.activeSession}
              </label>
              <select
                id="ls-select"
                value={liveSessionId}
                disabled={!eventId}
                onChange={(e) => {
                  setLiveSessionId(e.target.value);
                  setSubmissionId("");
                }}
                className="w-full bg-white border border-gray-200 text-text-primary text-sm rounded-xl px-3 py-2.5 focus:border-[#0B1220] focus:ring-2 focus:ring-[#0B1220]/10 outline-none transition disabled:opacity-50"
              >
                <option value="">{t.actions.select}</option>
                {(sessions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.room ? `(${s.room.name})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2" htmlFor="sub-select">
                {lang === "ja" ? "承認済みファイル" : "Approved File"}
              </label>
              <select
                id="sub-select"
                value={submissionId}
                disabled={!liveSessionId}
                onChange={(e) => setSubmissionId(e.target.value)}
                className="w-full bg-white border border-gray-200 text-text-primary text-sm rounded-xl px-3 py-2.5 focus:border-[#0B1220] focus:ring-2 focus:ring-[#0B1220]/10 outline-none transition disabled:opacity-50"
              >
                <option value="">{t.actions.select}</option>
                {(submissions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s as any).itemType === "cover"
                      ? `— ${(s as any).coverText ?? (lang === "ja" ? "カバー" : "Cover")} —`
                      : `${s.fileName ?? s.id} ${s.presenter ? `— ${s.presenter.displayName}` : ""}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedEvent && (
            <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50/90 border border-gray-100 rounded-xl text-xs">
              <div className="flex items-center gap-1.5 font-medium text-gray-700">
                <svg className="w-4 h-4 text-[#10B981] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                </svg>
                <span className="font-bold text-gray-500">{lang === "ja" ? "開催日時:" : "Date & Time:"}</span>
                <span className="font-semibold text-gray-900">
                  {formatEventSchedule(selectedEvent.startDate, selectedEvent.endDate, lang) ?? (lang === "ja" ? "日時未定" : "Date & time not specified")}
                </span>
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-1.5 text-gray-600 pl-3 border-l border-gray-200">
                  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <span className="font-medium text-gray-800">{selectedEvent.location}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border tracking-wider uppercase shadow-sm ${
                connState === "connected"
                  ? "bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30"
                  : connState === "locked" || connState === "error"
                    ? "bg-red-50 text-red-600 border border-red-200"
                    : "bg-gray-100 text-gray-600 border-gray-200"
              }`}
            >
              {getConnStateLabel(connState)}
            </span>
            {connState === "connected" && (
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border tracking-wider uppercase shadow-sm ${
                  displayConnected
                    ? "bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30"
                    : "bg-amber-50 text-amber-600 border-amber-200"
                }`}
              >
                {displayConnected
                  ? (lang === "ja" ? "ポディウム接続済み" : "Podium Connected")
                  : (lang === "ja" ? "ポディウム未接続" : "No Podium Display")}
              </span>
            )}
            {connState === "connected" ? (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition shadow-sm"
              >
                {lang === "ja" ? "切断" : "Disconnect"}
              </button>
            ) : (
              <button
                disabled={!liveSessionId || connState === "connecting"}
                onClick={() => void handleConnect()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#0B1220] hover:bg-[#1A253C] text-white transition shadow-sm disabled:opacity-50"
              >
                {connState === "connecting" ? (lang === "ja" ? "接続中..." : "Connecting...") : (lang === "ja" ? "接続" : "Connect")}
              </button>
            )}
          </div>
        </div>

        {/* Approved Presentations List (Task 8: Auto-load approved PPTs with presenter names) */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-[#0B1220] tracking-tight flex items-center gap-2">
                <svg className="w-4 h-4 text-[#10B981]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t.presOpsDashboard.approvedPresentations}
              </h2>
              <p className="text-gray-500 text-xs mt-0.5">
                {t.presOpsDashboard.approvedPresentationsSub}
              </p>
            </div>
            {submissions && submissions.length > 0 && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20">
                {submissions.length} {lang === "ja" ? "件" : "files"}
              </span>
            )}
          </div>

          {!eventId || !liveSessionId ? (
            <div className="p-8 text-center bg-gray-50/70 border border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center">
              <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p className="text-xs font-semibold text-gray-400">{t.presOpsDashboard.selectEventAndSessionHint}</p>
            </div>
          ) : submissionsLoading ? (
            <div className="p-8 text-center">
              <p className="text-xs font-semibold text-gray-400">{lang === "ja" ? "承認済みファイルを読み込み中…" : "Loading approved presentations…"}</p>
            </div>
          ) : !submissions || submissions.length === 0 ? (
            <div className="p-8 text-center bg-gray-50/70 border border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center">
              <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-xs font-bold text-gray-600">{t.presOpsDashboard.noApprovedPresentations}</p>
              <p className="text-[11px] text-gray-400 mt-1 max-w-md">{t.presOpsDashboard.noApprovedPresentationsHint}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {(submissions ?? []).map((sub) => {
                const isSelected = sub.id === submissionId;
                const isCover = (sub as any).itemType === "cover";
                const presenterName = sub.presenter?.displayName || sub.presenter?.name || (isCover ? "—" : (lang === "ja" ? "管理者・スタッフ登録" : "Staff / Direct Upload"));
                const organization = sub.presenter?.organization;
                const fileName = isCover ? `🖼 ${(sub as any).coverText ?? (lang === "ja" ? "カバースライド" : "Cover Slide")}` : (sub.fileName ?? "Presentation");

                return (
                  <div
                    key={sub.id}
                    onClick={() => setSubmissionId(sub.id)}
                    className={`p-4 rounded-xl border transition cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                      isSelected
                        ? "bg-[#10B981]/5 border-[#10B981] shadow-sm ring-1 ring-[#10B981]"
                        : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/60"
                    }`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`p-2.5 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isCover ? "bg-indigo-50 text-indigo-600" : "bg-blue-50 text-blue-600"
                      }`}>
                        {isCover ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-gray-900 truncate">{fileName}</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/25 uppercase tracking-wider">
                            {t.presOpsDashboard.approvedBadge}
                          </span>
                          {isSelected && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0B1220] text-white uppercase tracking-wider">
                              {t.presOpsDashboard.loaded}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1 font-semibold text-gray-700">
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                            <span>{t.presOpsDashboard.presenter}:</span>
                            <span className="text-gray-900 font-bold">{presenterName}</span>
                            {organization ? <span className="text-gray-400 text-[11px]">({organization})</span> : null}
                          </span>
                          {!isCover && (sub as any).fileSize ? (
                            <span className="text-gray-400 font-medium">· {formatBytes((sub as any).fileSize)}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto flex-shrink-0">
                      <button
                        type="button"
                        disabled={!canOperate || (loadingFile && isSelected)}
                        onClick={(e) => {
                          e.stopPropagation();
                          void loadPresentationById(sub.id);
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm flex items-center gap-1.5 ${
                          isSelected
                            ? "bg-[#0B1220] hover:bg-[#1A253C] text-white"
                            : "bg-white hover:bg-gray-50 text-gray-700 border border-gray-200"
                        } disabled:opacity-50`}
                      >
                        {loadingFile && isSelected ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span>{lang === "ja" ? "読み込み中..." : "Loading..."}</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5 text-[#10B981]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                            </svg>
                            <span>{t.presOpsDashboard.loadIntoPodium}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-6">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
            {lang === "ja" ? "再生・投影コントロール" : "Playback Controls"}
          </h2>
          {connState === "connected" && !displayConnected && (
            <p className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              {lang === "ja"
                ? "ポディウムアプリがこのセッションにディスプレイとして接続されていません。ポディウムアプリで「ディスプレイとして接続」を行ってください。"
                : "The podium app is not connected as a display for this session. Open the podium app and connect it as a display before using these controls."}
            </p>
          )}
          <div className="flex flex-wrap gap-2.5">
            <button
              disabled={!canOperate || !selectedSubmission || loadingFile}
              onClick={() => void handleLoad()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#0B1220] hover:bg-[#1A253C] text-white transition shadow-sm disabled:opacity-50"
            >
              {loadingFile ? (lang === "ja" ? "読み込み中..." : "Loading...") : (lang === "ja" ? "読み込み" : "Load")}
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "play" })}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 transition shadow-sm disabled:opacity-50"
            >
              {lang === "ja" ? "再生" : "Play"}
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "prev_slide" })}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 transition shadow-sm disabled:opacity-50"
            >
              {t.presOpsDashboard.previousSlide}
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "next_slide" })}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 transition shadow-sm disabled:opacity-50"
            >
              {t.presOpsDashboard.nextSlide}
            </button>
            <button
              disabled={!canOperate}
              onClick={() => sendCommand({ type: "exit_slideshow" })}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition shadow-sm disabled:opacity-50"
            >
              {lang === "ja" ? "終了" : "Exit"}
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            {lang === "ja" ? "アクティビティログ" : "Activity Log"}
          </h2>
          <div className="font-mono text-xs text-text-secondary space-y-1.5 max-h-56 overflow-y-auto">
            {log.length === 0 && <p className="text-gray-400 font-semibold">{lang === "ja" ? "アクティビティはまだありません。" : "No activity yet."}</p>}
            {log.map((line, i) => (
              <p key={i} className="border-b border-gray-50 pb-1">{line}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
