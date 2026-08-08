"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";

type SessionStatus = "scheduled" | "live" | "completed" | "cancelled";

const STATUS_COLORS: Record<SessionStatus, string> = {
  scheduled: "bg-accent-blue/10 text-accent-blue border-accent-blue/30",
  live: "bg-success/10 text-success border-success/30",
  completed: "bg-accent-sage/10 text-accent-sage border-accent-sage/30",
  cancelled: "bg-error/10 text-error border-error/30",
};

export default function SessionsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formRoomId, setFormRoomId] = useState("");
  const [formStartsAt, setFormStartsAt] = useState("");
  const [formEndsAt, setFormEndsAt] = useState("");
  const [formStatus, setFormStatus] = useState<SessionStatus>("scheduled");
  const [formSortOrder, setFormSortOrder] = useState("0");
  const [error, setError] = useState("");

  if (!user || (user.role !== "admin" && user.role !== "staff")) {
    router.replace("/");
    return null;
  }

  const { data: event } = api.event.getById.useQuery({ id: eventId });
  const { data: rooms } = api.room.listByEvent.useQuery({ eventId });
  const { data: sessions, refetch, isLoading } = api.liveSession.listByEvent.useQuery({ eventId });

  const createMutation = api.liveSession.create.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const updateMutation = api.liveSession.update.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const deleteMutation = api.liveSession.delete.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setIsOpen(false);
    setEditId(null);
    setFormName("");
    setFormRoomId("");
    setFormStartsAt("");
    setFormEndsAt("");
    setFormStatus("scheduled");
    setFormSortOrder("0");
    setError("");
  }

  function openCreate() {
    resetForm();
    setIsOpen(true);
  }

  function openEdit(s: {
    id: string;
    name: string;
    roomId: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    status: string;
    sortOrder: number;
  }) {
    setEditId(s.id);
    setFormName(s.name);
    setFormRoomId(s.roomId ?? "");
    setFormStartsAt(s.startsAt ? new Date(s.startsAt).toISOString().slice(0, 16) : "");
    setFormEndsAt(s.endsAt ? new Date(s.endsAt).toISOString().slice(0, 16) : "");
    setFormStatus(s.status as SessionStatus);
    setFormSortOrder(s.sortOrder.toString());
    setError("");
    setIsOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (editId) {
      updateMutation.mutate({
        id: editId,
        name: formName,
        roomId: formRoomId || null,
        startsAt: formStartsAt ? new Date(formStartsAt).toISOString() : null,
        endsAt: formEndsAt ? new Date(formEndsAt).toISOString() : null,
        status: formStatus,
        sortOrder: parseInt(formSortOrder),
      });
    } else {
      createMutation.mutate({
        eventId,
        name: formName,
        roomId: formRoomId || undefined,
        startsAt: formStartsAt ? new Date(formStartsAt).toISOString() : undefined,
        endsAt: formEndsAt ? new Date(formEndsAt).toISOString() : undefined,
        sortOrder: parseInt(formSortOrder),
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-2">
          <Link href="/admin/events" className="text-xs text-accent-blue hover:underline">
            ← Back to Events
          </Link>
        </div>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Sessions</h1>
            <p className="text-text-secondary text-sm mt-1">
              {event ? `Event: ${event.name}` : "Loading..."}
            </p>
          </div>
          <button
            id="btn-create-session"
            onClick={openCreate}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            Add Session
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">{error}</div>
        )}

        {isLoading ? (
          <div className="py-20 text-center text-text-secondary">Loading sessions...</div>
        ) : (
          <div className="grid gap-3">
            {(sessions ?? []).map((s) => (
              <div key={s.id} className="bg-bg-secondary border border-border-soft rounded-xl p-5 shadow-hard hover:shadow-hard-hover transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-text-muted text-xs font-mono">#{s.sortOrder}</span>
                      <h2 className="text-base font-bold text-text-primary truncate">{s.name}</h2>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shadow-hard-sm ${STATUS_COLORS[s.status as SessionStatus]}`}>
                        {s.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-text-muted mt-1">
                      {s.room && <span>Room: {s.room.name}</span>}
                      {s.startsAt && <span>Start: {new Date(s.startsAt).toLocaleString()}</span>}
                      {s.endsAt && <span>End: {new Date(s.endsAt).toLocaleString()}</span>}
                      <span>{s._count.presentationAssignments} presenter{s._count.presentationAssignments !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => openEdit(s)}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition shadow-hard-sm"
                    >
                      Edit
                    </button>
                    <Link
                      href={`/admin/events/${eventId}/sessions/${s.id}/assignments`}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                    >
                      Assignments
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm(`Soft-delete session "${s.name}"?`)) {
                          deleteMutation.mutate({ id: s.id });
                        }
                      }}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {(sessions ?? []).length === 0 && (
              <div className="bg-bg-secondary border border-border-soft rounded-xl p-10 text-center text-text-muted shadow-hard">
                No sessions yet for this event.
              </div>
            )}
          </div>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-bg-secondary border border-border-soft w-full max-w-lg rounded-xl p-6 shadow-hard-lg overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold text-text-primary mb-6">{editId ? "Edit Session" : "Add Session"}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="sess-name">Session Name</label>
                <input id="sess-name" type="text" required value={formName} onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="sess-room">Room</label>
                <select id="sess-room" value={formRoomId} onChange={(e) => setFormRoomId(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none">
                  <option value="">— No room assigned —</option>
                  {(rooms ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="sess-start">Starts At</label>
                  <input id="sess-start" type="datetime-local" value={formStartsAt} onChange={(e) => setFormStartsAt(e.target.value)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="sess-end">Ends At</label>
                  <input id="sess-end" type="datetime-local" value={formEndsAt} onChange={(e) => setFormEndsAt(e.target.value)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {editId && (
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="sess-status">Status</label>
                    <select id="sess-status" value={formStatus} onChange={(e) => setFormStatus(e.target.value as SessionStatus)}
                      className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none">
                      <option value="scheduled">Scheduled</option>
                      <option value="live">Live</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="sess-order">Sort Order</label>
                  <input id="sess-order" type="number" min="0" value={formSortOrder} onChange={(e) => setFormSortOrder(e.target.value)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
                </div>
              </div>
              {error && <p className="text-error text-xs">{error}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={resetForm}
                  className="bg-transparent hover:bg-bg-primary text-text-secondary border border-border-soft px-4 py-2 rounded-lg text-sm transition shadow-hard-sm">
                  Cancel
                </button>
                <button type="submit" disabled={isPending}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard">
                  {isPending ? "Saving..." : editId ? "Save" : "Add Session"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
