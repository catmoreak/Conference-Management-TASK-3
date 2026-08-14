"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "~/app/_components/LanguageContext";

type Event = {
  id: string;
  name: string;
  location: string | null;
  startDate: string | null;
};

type SubmissionSummary = {
  id: string;
  status: string;
  fileName: string | null;
  reviewNote: string | null;
  createdAt: string;
};

type Presenter = {
  id: string;
  displayName: string;
  organization: string | null;
  title: string | null;
  presentationAssignments: {
    id: string;
    liveSession: {
      id: string;
      name: string;
      startsAt: string | null;
      room: { name: string } | null;
    } | null;
  }[];
  submissions: SubmissionSummary[];
};

type Step = "select-event" | "select-presenter" | "confirm" | "upload" | "complete";

const INACTIVITY_TIMEOUT = 60_000; // 60 seconds

export default function CheckinPage() {
  const { lang, t } = useLanguage();

  const [step, setStep] = useState<Step>("select-event");
  const [events, setEvents] = useState<Event[]>([]);
  const [presenters, setPresenters] = useState<Presenter[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedPresenter, setSelectedPresenter] = useState<Presenter | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState("");
  const [search, setSearch] = useState("");

  const reset = useCallback(() => {
    setStep("select-event");
    setSelectedEvent(null);
    setSelectedPresenter(null);
    setSelectedFile(null);
    setUploadResult(null);
    setError(null);
    setOrgFilter("");
    setSearch("");
  }, []);

  // Inactivity reset
  useEffect(() => {
    const timer = setTimeout(reset, INACTIVITY_TIMEOUT);
    const events = ["mousemove", "keydown", "click", "touchstart"];
    const refresh = () => {
      clearTimeout(timer);
    };
    events.forEach((e) => window.addEventListener(e, refresh));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, refresh));
    };
  }, [step, reset]);

  // Fetch events on mount
  useEffect(() => {
    fetch("/api/checkin")
      .then((r) => r.json())
      .then((data: { events: Event[] }) => setEvents(data.events ?? []))
      .catch(() => setError(lang === "ja" ? "イベントの読み込みに失敗しました。" : "Failed to load events."));
  }, [lang]);

  // Fetch presenters when event selected
  useEffect(() => {
    if (!selectedEvent) return;
    fetch(`/api/checkin?eventId=${selectedEvent.id}`)
      .then((r) => r.json())
      .then((data: { presenters: Presenter[] }) => setPresenters(data.presenters ?? []))
      .catch(() => setError(lang === "ja" ? "発表者情報の読み込みに失敗しました。" : "Failed to load presenters."));
  }, [selectedEvent, lang]);

  const organizations = [...new Set(presenters.map((p) => p.organization ?? (lang === "ja" ? "その他" : "Other")))];

  const filteredPresenters = presenters.filter((p) => {
    const matchOrg = !orgFilter || (p.organization ?? (lang === "ja" ? "その他" : "Other")) === orgFilter;
    const matchSearch =
      !search ||
      p.displayName.toLowerCase().includes(search.toLowerCase()) ||
      (p.organization ?? "").toLowerCase().includes(search.toLowerCase());
    return matchOrg && matchSearch;
  });

  async function handleUpload() {
    if (!selectedFile || !selectedPresenter) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("presenterId", selectedPresenter.id);
      const res = await fetch("/api/checkin/upload", { method: "POST", body: formData });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? (lang === "ja" ? "アップロードに失敗しました" : "Upload failed"));
      setUploadResult(selectedFile.name);
      setStep("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : (lang === "ja" ? "アップロードに失敗しました" : "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  // Auto-clear after completion
  useEffect(() => {
    if (step !== "complete") return;
    const t = setTimeout(reset, 5000);
    return () => clearTimeout(t);
  }, [step, reset]);

  const getStatusBadge = (status: string) => {
    if (lang === "ja") {
      switch (status) {
        case "pending": return { label: "確認待ち", bg: "#fef3c7", fg: "#92400e" };
        case "approved": return { label: "承認済み", bg: "#dcfce7", fg: "#166534" };
        case "rejected": return { label: "再アップロードが必要", bg: "#fee2e2", fg: "#b91c1c" };
      }
    }
    switch (status) {
      case "pending": return { label: "Pending review", bg: "#fef3c7", fg: "#92400e" };
      case "approved": return { label: "Approved", bg: "#dcfce7", fg: "#166534" };
      case "rejected": return { label: "Needs a new upload", bg: "#fee2e2", fg: "#b91c1c" };
    }
    return { label: status, bg: "#f1f5f9", fg: "#475569" };
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "sans-serif" }}>
      
      {/* Header */}
      <div style={{ marginBottom: "2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1e293b" }}>{t.checkinPage.title}</h1>
        <p style={{ fontSize: "1.25rem", color: "#64748b" }}>
          {step === "select-event" && (lang === "ja" ? "ステップ 1 — イベントを選択してください" : "Step 1 — Select your event")}
          {step === "select-presenter" && (lang === "ja" ? "ステップ 2 — お名前を選択してください" : "Step 2 — Select your name")}
          {step === "confirm" && (lang === "ja" ? "ステップ 3 — 登録内容を確認してください" : "Step 3 — Confirm your details")}
          {step === "upload" && (lang === "ja" ? "ステップ 4 — 資料ファイルをアップロードしてください" : "Step 4 — Upload your materials")}
          {step === "complete" && (lang === "ja" ? "アップロード完了！" : "Upload complete!")}
        </p>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "1rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "1.125rem" }}>
          {error}
        </div>
      )}

      {/* Step 1 — Select Event */}
      {step === "select-event" && (
        <div style={{ width: "100%", maxWidth: "600px" }}>
          {events.length === 0 ? (
            <p style={{ textAlign: "center", color: "#64748b", fontSize: "1.25rem" }}>
              {lang === "ja" ? "有効なイベントが見つかりません。スタッフにお声がけください。" : "No active events found. Please ask staff for assistance."}
            </p>
          ) : (
            events.map((event) => (
              <button key={event.id} onClick={() => { setSelectedEvent(event); setStep("select-presenter"); }}
                style={{ display: "block", width: "100%", padding: "1.5rem", marginBottom: "1rem", fontSize: "1.25rem", fontWeight: 600, background: "#fff", border: "2px solid #e2e8f0", borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
                {event.name}
                {event.location && <span style={{ display: "block", fontSize: "1rem", color: "#64748b", fontWeight: 400 }}>{event.location}</span>}
              </button>
            ))
          )}
        </div>
      )}

      {/* Step 2 — Select Presenter */}
      {step === "select-presenter" && (
        <div style={{ width: "100%", maxWidth: "700px" }}>
          <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <input placeholder={t.checkinPage.searchAttendee} value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, padding: "0.75rem 1rem", fontSize: "1.125rem", border: "2px solid #e2e8f0", borderRadius: "8px" }} />
            <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}
              style={{ padding: "0.75rem 1rem", fontSize: "1.125rem", border: "2px solid #e2e8f0", borderRadius: "8px" }}>
              <option value="">{lang === "ja" ? "すべての所属組織" : "All Organizations"}</option>
              {organizations.map((org) => <option key={org} value={org}>{org}</option>)}
            </select>
          </div>
          <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
            {filteredPresenters.map((p) => {
              const latest = p.submissions[0];
              const badge = latest ? getStatusBadge(latest.status) : null;
              return (
                <button key={p.id} onClick={() => { setSelectedPresenter(p); setStep("confirm"); }}
                  style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "1.25rem", marginBottom: "0.75rem", fontSize: "1.125rem", fontWeight: 600, background: "#fff", border: "2px solid #e2e8f0", borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
                  <span>
                    {p.displayName}
                    {p.organization && <span style={{ display: "block", fontSize: "1rem", color: "#64748b", fontWeight: 400 }}>{p.organization}</span>}
                  </span>
                  {badge && (
                    <span style={{ flexShrink: 0, padding: "0.25rem 0.75rem", fontSize: "0.875rem", fontWeight: 600, borderRadius: "9999px", background: badge.bg, color: badge.fg }}>
                      {badge.label}
                    </span>
                  )}
                </button>
              );
            })}
            {filteredPresenters.length === 0 && <p style={{ textAlign: "center", color: "#64748b", fontSize: "1.125rem" }}>{t.checkinPage.noAttendees}</p>}
          </div>
          <button onClick={() => setStep("select-event")} style={{ marginTop: "1rem", padding: "0.75rem 1.5rem", fontSize: "1.125rem", background: "#f1f5f9", border: "none", borderRadius: "8px", cursor: "pointer" }}>← {t.actions.back}</button>
        </div>
      )}

      {/* Step 3 — Confirm */}
      {step === "confirm" && selectedPresenter && (
        <div style={{ width: "100%", maxWidth: "600px", background: "#fff", padding: "2rem", borderRadius: "16px", border: "2px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>{lang === "ja" ? "登録内容をご確認ください" : "Please confirm your details"}</h2>
          <p style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}><strong>{lang === "ja" ? "氏名:" : "Name:"}</strong> {selectedPresenter.displayName}</p>
          {selectedPresenter.organization && <p style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}><strong>{lang === "ja" ? "所属:" : "Organization:"}</strong> {selectedPresenter.organization}</p>}
          {selectedPresenter.title && <p style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}><strong>{lang === "ja" ? "役職:" : "Title:"}</strong> {selectedPresenter.title}</p>}
          {selectedPresenter.presentationAssignments.map((a) => a.liveSession && (
            <p key={a.id} style={{ fontSize: "1.125rem", color: "#475569", marginBottom: "0.25rem" }}>
              📍 {a.liveSession.room?.name ?? "TBD"} — {a.liveSession.name}
              {a.liveSession.startsAt && ` at ${new Date(a.liveSession.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            </p>
          ))}
          {(() => {
            const latest = selectedPresenter.submissions[0];
            if (!latest) return null;
            if (latest.status === "approved") {
              return (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "#dcfce7", border: "2px solid #86efac", borderRadius: "12px", color: "#166534" }}>
                  <strong>{lang === "ja" ? "発表資料は既に承認されています。" : "Your presentation has already been approved."}</strong>
                  <p style={{ marginTop: "0.25rem", fontSize: "1rem" }}>
                    {lang === "ja" ? "変更が必要な場合はスタッフにお問い合わせください。" : "If you need to make changes, please see conference staff."}
                  </p>
                </div>
              );
            }
            if (latest.status === "rejected") {
              return (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "#fee2e2", border: "2px solid #fca5a5", borderRadius: "12px", color: "#b91c1c" }}>
                  <strong>{lang === "ja" ? "前回のアップロードに修正が必要です。" : "Your previous upload needs a correction."}</strong>
                  {latest.reviewNote && <p style={{ marginTop: "0.25rem", fontSize: "1rem" }}>{lang === "ja" ? "理由: " : "Reason: "}{latest.reviewNote}</p>}
                  <p style={{ marginTop: "0.25rem", fontSize: "1rem" }}>{lang === "ja" ? "下記より修正済みファイルをアップロードしてください。" : "Please upload a corrected file below."}</p>
                </div>
              );
            }
            return (
              <div style={{ marginTop: "1rem", padding: "1rem", background: "#fef3c7", border: "2px solid #fcd34d", borderRadius: "12px", color: "#92400e" }}>
                {lang === "ja" ? "既に " : "You already uploaded "}<strong>{latest.fileName ?? (lang === "ja" ? "ファイル" : "a file")}</strong>{lang === "ja" ? " をアップロード済みで確認待ちです。再アップロードすると置き換わります。" : ", still awaiting review. Uploading a new file below will replace it."}
              </div>
            );
          })()}
          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            {selectedPresenter.submissions[0]?.status === "approved" ? (
              <button onClick={() => setStep("select-presenter")}
                style={{ flex: 1, padding: "1rem", fontSize: "1.25rem", fontWeight: 700, background: "#f1f5f9", color: "#1e293b", border: "none", borderRadius: "12px", cursor: "pointer", minHeight: "64px" }}>
                ← {lang === "ja" ? "検索に戻る" : "Back to search"}
              </button>
            ) : (
              <button onClick={() => setStep("upload")}
                style={{ flex: 1, padding: "1rem", fontSize: "1.25rem", fontWeight: 700, background: "#2563eb", color: "#fff", border: "none", borderRadius: "12px", cursor: "pointer", minHeight: "64px" }}>
                ✓ {lang === "ja" ? "はい、本人です" : "Yes, this is me"}
              </button>
            )}
            <button onClick={() => setStep("select-presenter")}
              style={{ padding: "1rem 1.5rem", fontSize: "1.125rem", background: "#f1f5f9", border: "none", borderRadius: "12px", cursor: "pointer" }}>
              ← {t.actions.back}
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Upload */}
      {step === "upload" && (
        <div style={{ width: "100%", maxWidth: "600px", background: "#fff", padding: "2rem", borderRadius: "16px", border: "2px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>
            {selectedPresenter?.submissions[0]?.status === "rejected" ? (lang === "ja" ? "修正済みファイルをアップロード" : "Upload your corrected file") : (lang === "ja" ? "プレゼンテーションファイルを選択" : "Select your presentation file")}
          </h2>
          <p style={{ fontSize: "1.125rem", color: "#64748b", marginBottom: "1.5rem" }}>
            {lang === "ja" ? "利用可能形式: .pptx, .pdf / 最大サイズ: 200MB" : "Accepted formats: .pptx, .pdf. Maximum size: 200MB."}
          </p>
          <input type="file" accept=".pptx,.pdf,.ppt"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            style={{ display: "block", width: "100%", padding: "1rem", fontSize: "1.125rem", border: "2px dashed #cbd5e1", borderRadius: "12px", marginBottom: "1.5rem", cursor: "pointer" }} />
          {selectedFile && <p style={{ fontSize: "1.125rem", color: "#475569", marginBottom: "1rem" }}>{lang === "ja" ? "選択済み: " : "Selected: "}<strong>{selectedFile.name}</strong> ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)</p>}
          <div style={{ display: "flex", gap: "1rem" }}>
            <button onClick={handleUpload} disabled={!selectedFile || uploading}
              style={{ flex: 1, padding: "1rem", fontSize: "1.25rem", fontWeight: 700, background: selectedFile && !uploading ? "#16a34a" : "#94a3b8", color: "#fff", border: "none", borderRadius: "12px", cursor: selectedFile && !uploading ? "pointer" : "not-allowed", minHeight: "64px" }}>
              {uploading ? (lang === "ja" ? "アップロード中..." : "Uploading...") : (lang === "ja" ? "⬆ ファイルを送信" : "⬆ Upload File")}
            </button>
            <button onClick={() => setStep("confirm")} disabled={uploading}
              style={{ padding: "1rem 1.5rem", fontSize: "1.125rem", background: "#f1f5f9", border: "none", borderRadius: "12px", cursor: "pointer" }}>
              ← {t.actions.back}
            </button>
          </div>
        </div>
      )}

      {/* Step 5 — Complete */}
      {step === "complete" && (
        <div style={{ textAlign: "center", maxWidth: "600px" }}>
          <div style={{ fontSize: "5rem", marginBottom: "1rem" }}>✅</div>
          <h2 style={{ fontSize: "2rem", fontWeight: 700, color: "#16a34a", marginBottom: "1rem" }}>{lang === "ja" ? "送信が完了しました！" : "Upload Successful!"}</h2>
          <p style={{ fontSize: "1.25rem", color: "#475569", marginBottom: "0.5rem" }}><strong>{uploadResult}</strong> {lang === "ja" ? "を受領しました。" : "has been received."}</p>
          <p style={{ fontSize: "1.125rem", color: "#64748b" }}>{lang === "ja" ? "画面は 5 秒後にリセットされます。" : "This screen will reset in 5 seconds."}</p>
        </div>
      )}
    </div>
  );
}