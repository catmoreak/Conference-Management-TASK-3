"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useLanguage } from "~/app/_components/LanguageContext";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  approved: "bg-success/10 text-success border-success/30",
  rejected: "bg-error/10 text-error border-error/30",
};

const CHECKLIST_ITEMS = [
  { key: "opensCorrectly", labelEn: "File opens and renders correctly", labelJa: "ファイルが正常に開いて表示される" },
  { key: "contentMatchesSession", labelEn: "Content matches the assigned session/topic", labelJa: "内容が割り当てられたセッション/テーマと一致している" },
  { key: "noProhibitedContent", labelEn: "No prohibited or inappropriate content", labelJa: "禁止コンテンツや不適切な内容が含まれていない" },
  { key: "formatSupported", labelEn: "File format is supported (.pptx, .ppt, .pdf)", labelJa: "サポートされているファイル形式である (.pptx, .ppt, .pdf)" },
] as const;

type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];
type ChecklistState = Record<ChecklistKey, boolean>;

const EMPTY_CHECKLIST: ChecklistState = {
  opensCorrectly: false,
  contentMatchesSession: false,
  noProhibitedContent: false,
  formatSupported: false,
};

export default function StaffDashboard() {
  const { user, signOut } = useAuth();
  const { lang, t } = useLanguage();
  const [eventId, setEventId] = useState("");
  const [error, setError] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistState>(EMPTY_CHECKLIST);

  const { data: events } = api.event.list.useQuery();
  const {
    data: submissions,
    refetch,
    isLoading,
  } = api.submission.listByEvent.useQuery({ eventId }, { enabled: !!eventId });

  const approveMutation = api.submission.approve.useMutation({
    onSuccess: () => {
      setReviewingId(null);
      setChecklist(EMPTY_CHECKLIST);
      void refetch();
    },
    onError: (e) => setError(e.message),
  });
  const rejectMutation = api.submission.reject.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });

  function handleReject(id: string) {
    const reason = window.prompt(lang === "ja" ? "却下理由を入力してください:" : "Reason for rejecting this submission:");
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(lang === "ja" ? "却下理由の入力は必須です。" : "A rejection reason is required.");
      return;
    }
    rejectMutation.mutate({ id, reason: trimmed });
  }

  function openReview(id: string) {
    setError("");
    setReviewingId(id);
    setChecklist(EMPTY_CHECKLIST);
  }

  function toggleChecklistItem(key: ChecklistKey) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const checklistComplete = CHECKLIST_ITEMS.every((item) => checklist[item.key]);

  function confirmApprove(id: string) {
    if (!checklistComplete) return;
    approveMutation.mutate({
      id,
      checklist: {
        opensCorrectly: true,
        contentMatchesSession: true,
        noProhibitedContent: true,
        formatSupported: true,
      },
    });
  }

  async function handleView(submission: { id: string; fileName: string | null; objectKey: string | null }) {
    setError("");
    setViewingId(submission.id);
    try {
      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileType: "original",
          fileId: submission.id,
          fileName: submission.fileName ?? "file",
          objectKey: submission.objectKey ?? undefined,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? (lang === "ja" ? "ダウンロードURLの取得に失敗しました。" : "Failed to get a download URL for this file."));
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } finally {
      setViewingId(null);
    }
  }

  return (
    <div className="flex-1 bg-[#F8FAFC] text-text-secondary p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#0B1220] tracking-tight">{t.staffDashboard.title}</h1>
            <p className="text-gray-500 text-xs mt-1">
              {t.staffDashboard.subTitle}
            </p>
          </div>
          <button
            onClick={() => void signOut()}
            className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 font-semibold px-4 py-2.5 rounded-xl text-sm transition shadow-sm"
          >
            {t.signOut}
          </button>
        </div>

        {user && (
          <div className="bg-white border border-gray-200 p-4 rounded-xl text-xs mb-6 shadow-sm flex items-center gap-2">
            <span>{lang === "ja" ? "ログイン中:" : "Signed in as:"}</span>
            <span className="font-bold text-[#0B1220]">{user.name}</span>
            <span className="px-2 py-0.5 text-[10px] font-bold bg-[#10B981]/15 text-[#10B981] rounded-full uppercase tracking-wider">{t.roles[user.role as keyof typeof t.roles] ?? user.role}</span>
          </div>
        )}

        <div className="mb-6 max-w-md">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2" htmlFor="event-select">
            {lang === "ja" ? "イベント絞り込み" : "Event Filter"}
          </label>
          <select
            id="event-select"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="w-full bg-white border border-gray-200 text-text-primary text-sm rounded-xl px-3 py-2.5 focus:border-[#0B1220] focus:ring-2 focus:ring-[#0B1220]/10 outline-none transition"
          >
            <option value="">{lang === "ja" ? "— イベントを選択 —" : "— Select an event —"}</option>
            {(events ?? []).map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm flex gap-3" role="alert">
            <span className="font-semibold" aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {!eventId ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm flex flex-col items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <span className="text-sm font-semibold text-gray-400">
              {lang === "ja" ? "提出ファイルを確認するにはイベントを選択してください。" : "Select an event to review its submissions."}
            </span>
          </div>
        ) : isLoading ? (
          <div className="py-20 text-center text-gray-400 font-semibold">{lang === "ja" ? "提出ファイルを読み込み中..." : "Loading submissions..."}</div>
        ) : (
          <div className="grid gap-4">
            {(submissions ?? []).map((s) => (
              <div
                key={s.id}
                className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-base font-bold text-[#0B1220] truncate">
                        {s.fileName ?? (lang === "ja" ? "無題のファイル" : "Untitled file")}
                      </h2>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border tracking-wider uppercase ${STATUS_COLORS[s.status] ?? ""}`}
                      >
                        {s.status === "approved" ? t.staffDashboard.statusApproved : s.status === "rejected" ? t.staffDashboard.statusRejected : t.staffDashboard.statusPending}
                      </span>
                      {s.revisionCount > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border border-border-soft bg-bg-primary text-text-muted">
                          {lang === "ja" ? `リビジョン ${s.revisionCount + 1}` : `Revision ${s.revisionCount + 1}`}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-text-muted mt-2">
                      {s.presenter && <span>{t.staffDashboard.speaker}: <strong className="text-text-primary">{s.presenter.displayName}</strong></span>}
                      {s.liveSession && (
                        <span>
                          {t.staffDashboard.session}: <strong className="text-text-primary">{s.liveSession.name}</strong>
                          {s.liveSession.room && ` (${s.liveSession.room.name})`}
                        </span>
                      )}
                      {s.fileSize && <span>{(s.fileSize / (1024 * 1024)).toFixed(1)} MB</span>}
                      <span>{new Date(s.createdAt).toLocaleString()}</span>
                      {s.reviewedAt && <span>{lang === "ja" ? "確認日時: " : "Reviewed "} {new Date(s.reviewedAt).toLocaleString()}</span>}
                    </div>
                    {s.reviewNote && (
                      <p className={`mt-3 text-xs p-3 bg-gray-50 rounded-lg ${s.status === "rejected" ? "text-red-600 border border-red-100" : "text-text-muted border border-gray-100"}`}>
                        <strong>{s.status === "rejected" ? (lang === "ja" ? "却下理由: " : "Rejection reason: ") : (lang === "ja" ? "前回の確認メモ: " : "Previous reviewer note: ")}</strong>
                        {s.reviewNote}
                      </p>
                    )}
                    {reviewingId === s.id && (
                      <div className="mt-4 p-4 bg-gray-50 border border-gray-100 rounded-xl">
                        <p className="text-xs font-bold text-[#0B1220] mb-3">
                          {lang === "ja" ? "承認前の事前確認事項:" : "Confirm before approving:"}
                        </p>
                        <div className="space-y-2">
                          {CHECKLIST_ITEMS.map((item) => (
                            <label key={item.key} className="flex items-center gap-2.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary">
                              <input
                                type="checkbox"
                                checked={checklist[item.key]}
                                onChange={() => toggleChecklistItem(item.key)}
                                className="accent-[#10B981] w-4 h-4 rounded"
                              />
                              {lang === "ja" ? item.labelJa : item.labelEn}
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-4">
                          <button
                            disabled={!checklistComplete || approveMutation.isPending}
                            onClick={() => confirmApprove(s.id)}
                            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#10B981] hover:bg-[#0D9488] text-white transition shadow-sm disabled:opacity-50"
                          >
                            {approveMutation.isPending ? (lang === "ja" ? "承認中..." : "Approving...") : (lang === "ja" ? "承認を確定" : "Confirm Approve")}
                          </button>
                          <button
                            onClick={() => setReviewingId(null)}
                            className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 transition shadow-sm"
                          >
                            {t.actions.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {s.objectKey && (
                      <button
                        disabled={viewingId === s.id}
                        onClick={() => void handleView(s)}
                        className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 transition shadow-sm disabled:opacity-50"
                      >
                        {viewingId === s.id ? (lang === "ja" ? "開いています..." : "Opening...") : t.actions.view}
                      </button>
                    )}
                    {s.status === "pending" && reviewingId !== s.id && (
                      <>
                        <button
                          onClick={() => openReview(s.id)}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/30 transition shadow-sm disabled:opacity-50"
                        >
                          {t.staffDashboard.approve}
                        </button>
                        <button
                          disabled={rejectMutation.isPending}
                          onClick={() => handleReject(s.id)}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition shadow-sm disabled:opacity-50"
                        >
                          {t.staffDashboard.reject}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {(submissions ?? []).length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm flex flex-col items-center justify-center">
                <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span className="text-sm font-semibold text-gray-400">{t.staffDashboard.noFiles}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
