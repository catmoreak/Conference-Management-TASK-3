"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  approved: "bg-success/10 text-success border-success/30",
  rejected: "bg-error/10 text-error border-error/30",
};

export default function StaffDashboard() {
  const { user, signOut } = useAuth();
  const [eventId, setEventId] = useState("");
  const [error, setError] = useState("");

  const { data: events } = api.event.list.useQuery();
  const {
    data: submissions,
    refetch,
    isLoading,
  } = api.submission.listByEvent.useQuery({ eventId }, { enabled: !!eventId });

  const approveMutation = api.submission.approve.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });
  const rejectMutation = api.submission.reject.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Staff Dashboard</h1>
            <p className="text-text-secondary text-sm mt-1">
              Review presentation materials submitted through the check-in kiosk.
            </p>
          </div>
          <button
            onClick={() => void signOut()}
            className="bg-bg-secondary hover:bg-white text-text-primary border border-border-soft font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover"
          >
            Sign Out
          </button>
        </div>

        {user && (
          <div className="bg-bg-secondary border border-border-soft p-4 rounded-lg text-sm mb-6 shadow-hard-sm">
            Signed in as <span className="font-bold text-text-primary">{user.name}</span>{" "}
            <span className="text-accent-blue capitalize">({user.role})</span>
          </div>
        )}

        <div className="mb-6">
          <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="event-select">
            Event
          </label>
          <select
            id="event-select"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="w-full max-w-md bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none"
          >
            <option value="">— Select an event —</option>
            {(events ?? []).map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        {!eventId ? (
          <div className="bg-bg-secondary border border-border-soft rounded-xl p-10 text-center text-text-muted shadow-hard">
            Select an event to review its submissions.
          </div>
        ) : isLoading ? (
          <div className="py-20 text-center text-text-secondary">Loading submissions...</div>
        ) : (
          <div className="grid gap-3">
            {(submissions ?? []).map((s) => (
              <div
                key={s.id}
                className="bg-bg-secondary border border-border-soft rounded-xl p-5 shadow-hard hover:shadow-hard-hover transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-base font-bold text-text-primary truncate">
                        {s.fileName ?? "Untitled file"}
                      </h2>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shadow-hard-sm ${STATUS_COLORS[s.status] ?? ""}`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-text-muted mt-1">
                      {s.presenter && <span>Presenter: {s.presenter.displayName}</span>}
                      {s.liveSession && (
                        <span>
                          Session: {s.liveSession.name}
                          {s.liveSession.room && ` (${s.liveSession.room.name})`}
                        </span>
                      )}
                      {s.fileSize && <span>{(s.fileSize / (1024 * 1024)).toFixed(1)} MB</span>}
                      <span>{new Date(s.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {s.publicUrl && (
                      <a
                        href={s.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                      >
                        View
                      </a>
                    )}
                    <button
                      disabled={s.status === "approved" || approveMutation.isPending}
                      onClick={() => approveMutation.mutate({ id: s.id })}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-success/10 hover:bg-success/20 text-success border border-success/30 transition shadow-hard-sm disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={s.status === "rejected" || rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate({ id: s.id })}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {(submissions ?? []).length === 0 && (
              <div className="bg-bg-secondary border border-border-soft rounded-xl p-10 text-center text-text-muted shadow-hard">
                No submissions yet for this event.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
