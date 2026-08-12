"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";

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
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// PowerPoint files can't be rendered natively by the browser -- clicking a
// raw .pptx URL just downloads it. Route those through Microsoft's Office
// Online viewer so they open inline instead. PDFs render natively, so they
// go straight to the raw URL.
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
  const [eventId, setEventId] = useState("");
  const [liveSessionId, setLiveSessionId] = useState("");
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: events } = api.event.list.useQuery();
  const { data: sessions } = api.liveSession.listByEvent.useQuery(
    { eventId },
    { enabled: !!eventId },
  );

  // Simplify the common case: most events only need one file list, so
  // auto-select the first live session (created automatically when the
  // event was made) instead of forcing a second manual picker. A dropdown
  // only appears if an event genuinely has more than one session.
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
      if (!res.ok) throw new Error(data.error ?? "Failed to load files");
      setFiles(data.files ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [liveSessionId]);

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
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(fileId: string) {
    if (!confirm("Delete this file? This cannot be undone.")) return;
    setError("");
    try {
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files/${fileId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleRenameSubmit(fileId: string) {
    if (!renameValue.trim()) return;
    setError("");
    try {
      const res = await fetch(`/api/live-sessions/${liveSessionId}/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: renameValue.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Rename failed");
      setRenamingId(null);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
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
        throw new Error(data.error ?? "Reorder failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
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
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Presentation Files</h1>
          <p className="text-text-secondary text-sm mt-1">
            Upload, rename, delete and reorder the PowerPoint/PDF files for an event. This list is shared
            live with the podium display app.
          </p>
        </div>

        <div className="bg-bg-secondary border border-border-soft rounded-xl p-6 shadow-hard-lg space-y-4 mb-6">
          <div className={`grid grid-cols-1 gap-4 ${(sessions ?? []).length > 1 ? "sm:grid-cols-2" : ""}`}>
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
                }}
                className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none"
              >
                <option value="">— Select an event —</option>
                {(events ?? []).map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>
            {/* Most events only have one session (auto-created with the
                event), so this picker only shows up when there's actually
                a choice to make — otherwise it would just be a confusing
                extra step. */}
            {(sessions ?? []).length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ls-select">
                  Session
                </label>
                <select
                  id="ls-select"
                  value={liveSessionId}
                  onChange={(e) => setLiveSessionId(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none"
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
              <label className="block text-xs font-semibold text-text-secondary mb-1">Add a file</label>
              <input
                type="file"
                accept=".pptx,.pptm,.ppt,.pdf"
                disabled={uploading}
                onChange={(e) => void handleUpload(e)}
                className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2"
              />
              {uploading && <p className="text-xs text-text-secondary mt-1">Uploading…</p>}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        {!liveSessionId ? (
          <p className="text-text-secondary text-sm">Select an event above to view and upload its files.</p>
        ) : loading ? (
          <p className="text-text-secondary text-sm">Loading files…</p>
        ) : files.length === 0 ? (
          <p className="text-text-secondary text-sm">No files uploaded for this event yet.</p>
        ) : (
          <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Uploaded by</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft text-sm">
                {files.map((f, index) => (
                  <tr key={f.id} className="hover:bg-white transition">
                    <td className="px-4 py-3">
                      {canReorder ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveFile(index, -1)}
                            className="px-2 py-1 rounded bg-bg-primary border border-border-soft text-xs disabled:opacity-30"
                            aria-label={`Move ${f.fileName ?? "file"} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={index === files.length - 1}
                            onClick={() => moveFile(index, 1)}
                            className="px-2 py-1 rounded bg-bg-primary border border-border-soft text-xs disabled:opacity-30"
                            aria-label={`Move ${f.fileName ?? "file"} down`}
                          >
                            ↓
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">{index + 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {renamingId === f.id ? (
                        <div className="flex gap-2">
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="bg-white border border-border-soft rounded px-2 py-1 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => void handleRenameSubmit(f.id)}
                            className="text-xs text-accent-blue font-semibold"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="text-xs text-text-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="font-semibold text-text-primary">
                          {f.fileName ?? "Untitled"}
                          {f.presenter && (
                            <span className="block text-xs text-text-secondary font-normal">{f.presenter.displayName}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{formatBytes(f.fileSize)}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {f.uploadedBy}
                      <span className="block text-[10px] text-text-muted">{new Date(f.uploadedAt).toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {f.publicUrl && (
                        <a
                          href={getPreviewUrl(f) ?? f.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-accent-blue underline mr-3"
                        >
                          View
                        </a>
                      )}
                      {canRename && renamingId !== f.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(f.id);
                            setRenameValue(f.fileName ?? "");
                          }}
                          className="text-xs text-text-secondary underline mr-3"
                        >
                          Rename
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(f.id)}
                          className="text-xs text-error underline"
                        >
                          Delete
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
