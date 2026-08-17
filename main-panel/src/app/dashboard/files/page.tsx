"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useLanguage } from "~/app/_components/LanguageContext";

interface SessionFile {
  id: string;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  publicUrl: string | null;
  status: string;
  sortOrder: number;
  uploadedBy: string;
  uploadedAt: string;
  presenter: { id: string; displayName: string } | null;
  itemType: "file" | "cover";
  coverText: string | null;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getPreviewUrl(file: SessionFile): string | null {
  if (!file.publicUrl) return null;
  const name = file.fileName?.toLowerCase() ?? "";
  const isPowerPoint =
    name.endsWith(".ppt") ||
    name.endsWith(".pptx") ||
    name.endsWith(".pptm") ||
    (file.contentType?.includes("presentation") ?? false);
  if (isPowerPoint) {
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(file.publicUrl)}`;
  }
  return file.publicUrl;
}

export default function SessionFilesPage() {
  const { user } = useAuth();
  const { lang, t } = useLanguage();

  const [eventId, setEventId] = useState("");
  const [liveSessionId, setLiveSessionId] = useState("");
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [coverText, setCoverText] = useState("");
  const [addingCover, setAddingCover] = useState(false);

  const { data: events } = api.event.list.useQuery();
  const { data: sessions } = api.liveSession.listByEvent.useQuery(
    { eventId },
    { enabled: !!eventId },
  );

  useEffect(() => {
    if (!eventId) {
      setLiveSessionId("");
      return;
    }
    if (!sessions || sessions.length === 0) {
      setLiveSessionId("");
      return;
    }
    if (!sessions.some((s) => s.id === liveSessionId)) {
      setLiveSessionId(sessions[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, sessions]);

  const canUpload = user?.role === "admin" || user?.role === "reviewer";
  const canDelete = user?.role === "admin" || user?.role === "reviewer";
  const canRename = user?.role === "admin";
  const canReorder = user?.role === "admin" || user?.role === "reviewer" || user?.role === "presenter";

  const fetchFiles = useCallback(async () => {
    if (!liveSessionId) {
      setFiles([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files`, {
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json()) as { files?: SessionFile[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? (lang === "ja" ? "ファイルの読み込みに失敗しました" : "Failed to load files"));
      setFiles(data.files ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === "ja" ? "ファイルの読み込みに失敗しました" : "Failed to load files"));
    } finally {
      setLoading(false);
    }
  }, [liveSessionId, lang]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !liveSessionId) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files`, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? (lang === "ja" ? "アップロードに失敗しました" : "Upload failed"));
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === "ja" ? "アップロードに失敗しました" : "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleAddCover() {
    if (!coverText.trim() || !liveSessionId) return;
    setAddingCover(true);
    setError("");
    try {
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverText: coverText.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? (lang === "ja" ? "カバースライドの追加に失敗しました" : "Failed to add cover slide"));
      setCoverText("");
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === "ja" ? "カバースライドの追加に失敗しました" : "Failed to add cover slide"));
    } finally {
      setAddingCover(false);
    }
  }

  async function handleDelete(fileId: string) {
    if (!confirm(t.filesPage.deleteConfirm)) return;
    setError("");
    try {
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files/${fileId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? (lang === "ja" ? "削除に失敗しました" : "Delete failed"));
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === "ja" ? "削除に失敗しました" : "Delete failed"));
    }
  }

  async function handleRenameSubmit(file: SessionFile) {
    if (!renameValue.trim()) return;
    setError("");
    try {
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          file.itemType === "cover" ? { coverText: renameValue.trim() } : { fileName: renameValue.trim() },
        ),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? (lang === "ja" ? "名前の変更に失敗しました" : "Rename failed"));
      setRenamingId(null);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === "ja" ? "名前の変更に失敗しました" : "Rename failed"));
    }
  }

  async function persistOrder(nextFiles: SessionFile[]) {
    setFiles(nextFiles);
    try {
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: nextFiles.map((f) => f.id) }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? (lang === "ja" ? "順序変更に失敗しました" : "Reorder failed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (lang === "ja" ? "順序変更に失敗しました" : "Reorder failed"));
      await fetchFiles();
    }
  }

  function moveFile(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const next = [...files];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    void persistOrder(next);
  }

  return (
    <div className="flex-1 bg-[#F8FAFC] text-text-secondary p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-[#0B1220] tracking-tight">{t.filesPage.title}</h1>
          <p className="text-gray-500 text-xs mt-1">
            {t.filesPage.subTitle}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm space-y-4 mb-6">
          <div className={`grid grid-cols-1 gap-4 ${(sessions ?? []).length > 1 ? "sm:grid-cols-2" : ""}`}>
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
                }}
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
            {(sessions ?? []).length > 1 && (
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2" htmlFor="ls-select">
                  {lang === "ja" ? "セッション" : "Session"}
                </label>
                <select
                  id="ls-select"
                  value={liveSessionId}
                  onChange={(e) => setLiveSessionId(e.target.value)}
                  className="w-full bg-white border border-gray-200 text-text-primary text-sm rounded-xl px-3 py-2.5 focus:border-[#0B1220] focus:ring-2 focus:ring-[#0B1220]/10 outline-none transition"
                >
                  {(sessions ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.room ? `(${s.room.name})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {canUpload && liveSessionId && (
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{lang === "ja" ? "ファイルを追加" : "Add a file"}</label>
              <input
                type="file"
                accept=".pptx,.pptm,.ppt,.pdf"
                disabled={uploading}
                onChange={(e) => void handleUpload(e)}
                className="w-full bg-white border border-gray-200 text-text-primary text-sm rounded-xl px-3 py-2.5 transition focus:border-[#0B1220]"
              />
              {uploading && <p className="text-xs text-text-secondary mt-1">{t.filesPage.uploading}</p>}
            </div>
          )}

          {canUpload && liveSessionId && (
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                {t.filesPage.addCoverSlide}
              </label>
              <p className="text-[11px] text-gray-400 mb-2">
                {lang === "ja" ? "セッション合間にプロジェクター画面へ表示するテキストスライドを追加できます。" : "A plain text screen (e.g. the event name) you can drop between files to keep the projector lit during a gap."}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={coverText}
                  onChange={(e) => setCoverText(e.target.value)}
                  placeholder={t.filesPage.coverPlaceholder}
                  disabled={addingCover}
                  maxLength={200}
                  className="flex-1 bg-white border border-gray-200 text-text-primary text-sm rounded-xl px-3 py-2.5 focus:border-[#0B1220] focus:ring-2 focus:ring-[#0B1220]/10 outline-none transition"
                />
                <button
                  type="button"
                  disabled={addingCover || !coverText.trim()}
                  onClick={() => void handleAddCover()}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#0B1220] hover:bg-[#1A253C] text-white transition shadow-sm disabled:opacity-50 whitespace-nowrap"
                >
                  {addingCover ? (lang === "ja" ? "追加中…" : "Adding…") : t.filesPage.addCoverBtn}
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm flex gap-3" role="alert">
            <span className="font-semibold" aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {!liveSessionId ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm flex flex-col items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
            </svg>
            <span className="text-sm font-semibold text-gray-400">
              {lang === "ja" ? "ファイルを表示およびアップロードするには、上部でイベントを選択してください。" : "Select an event above to view and upload its files."}
            </span>
          </div>
        ) : loading ? (
          <p className="text-gray-400 text-sm font-semibold">{lang === "ja" ? "ファイルを読み込み中…" : "Loading files…"}</p>
        ) : files.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm flex flex-col items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span className="text-sm font-semibold text-gray-400">
              {lang === "ja" ? "このイベントにはまだファイルがアップロードされていません。" : "No files uploaded for this event yet."}
            </span>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto shadow-sm">
            <table className="w-full min-w-[640px] text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                  <th className="px-6 py-3.5">{lang === "ja" ? "順序" : "Order"}</th>
                  <th className="px-6 py-3.5">{t.filesPage.tableHeaderFile}</th>
                  <th className="px-6 py-3.5">{t.filesPage.tableHeaderSize}</th>
                  <th className="px-6 py-3.5">{t.filesPage.tableHeaderUploadedBy}</th>
                  <th className="px-6 py-3.5 text-right">{t.filesPage.tableHeaderActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {files.map((f, index) => (
                  <tr key={f.id} className="hover:bg-gray-50/50 transition">
                    <td className="px-6 py-4">
                      {canReorder ? (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveFile(index, -1)}
                            className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-[10px] hover:bg-gray-50 disabled:opacity-30 transition font-bold"
                            aria-label={`Move ${f.fileName ?? "file"} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={index === files.length - 1}
                            onClick={() => moveFile(index, 1)}
                            className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-[10px] hover:bg-gray-50 disabled:opacity-30 transition font-bold"
                            aria-label={`Move ${f.fileName ?? "file"} down`}
                          >
                            ↓
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">{index + 1}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {renamingId === f.id ? (
                        <div className="flex gap-2">
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-[#0B1220] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void handleRenameSubmit(f)}
                            className="text-xs text-[#0B1220] font-bold hover:underline"
                          >
                            {t.actions.save}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="text-xs text-gray-500 font-semibold hover:underline"
                          >
                            {t.actions.cancel}
                          </button>
                        </div>
                      ) : f.itemType === "cover" ? (
                        <div className="font-bold text-[#0B1220]">
                          <span className="inline-block px-1.5 py-0.5 mr-1.5 rounded text-[9px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-200">
                            {t.filesPage.coverSlide}
                          </span>
                          {f.coverText ?? (lang === "ja" ? "無題" : "Untitled")}
                        </div>
                      ) : (
                        <div className="font-bold text-[#0B1220]">
                          {f.fileName ?? (lang === "ja" ? "無題" : "Untitled")}
                          {f.presenter && (
                            <span className="block text-[10px] text-gray-400 font-semibold mt-0.5">{f.presenter.displayName}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-text-secondary font-medium">
                      {f.itemType === "cover" ? "—" : formatBytes(f.fileSize)}
                    </td>
                    <td className="px-6 py-4 text-text-secondary">
                      <span className="font-semibold text-text-primary">{f.uploadedBy}</span>
                      <span className="block text-[10px] text-gray-400 font-semibold mt-0.5">{new Date(f.uploadedAt).toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap space-x-3">
                      {f.publicUrl && (
                        <a
                          href={getPreviewUrl(f) ?? f.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#10B981] font-bold hover:underline"
                        >
                          {t.actions.view}
                        </a>
                      )}
                      {canRename && renamingId !== f.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(f.id);
                            setRenameValue((f.itemType === "cover" ? f.coverText : f.fileName) ?? "");
                          }}
                          className="text-xs text-gray-600 font-semibold hover:underline"
                        >
                          {t.actions.rename}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(f.id)}
                          className="text-xs text-red-500 font-bold hover:underline"
                        >
                          {t.actions.delete}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
