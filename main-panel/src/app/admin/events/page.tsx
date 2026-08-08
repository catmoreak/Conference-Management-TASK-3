"use client";

import { useState } from "react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";

type EventStatus = "draft" | "published" | "completed" | "cancelled";

const STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Draft",
  published: "Published",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<EventStatus, string> = {
  draft: "bg-accent-slate/10 text-accent-slate border-accent-slate/30",
  published: "bg-success/10 text-success border-success/30",
  completed: "bg-accent-sage/10 text-accent-sage border-accent-sage/30",
  cancelled: "bg-error/10 text-error border-error/30",
};

export default function AdminEventsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string } | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formStatus, setFormStatus] = useState<EventStatus>("draft");
  const [error, setError] = useState("");

  if (!user || (user.role !== "admin" && user.role !== "staff")) {
    router.replace("/");
    return null;
  }

  const { data: events, refetch, isLoading } = api.event.list.useQuery();

  const createMutation = api.event.create.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const updateMutation = api.event.update.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setIsOpen(false);
    setEditTarget(null);
    setFormName("");
    setFormDescription("");
    setFormStartDate("");
    setFormEndDate("");
    setFormLocation("");
    setFormStatus("draft");
    setError("");
  }

  function openCreate() {
    setEditTarget(null);
    setFormName("");
    setFormDescription("");
    setFormStartDate("");
    setFormEndDate("");
    setFormLocation("");
    setFormStatus("draft");
    setError("");
    setIsOpen(true);
  }

  function openEdit(ev: {
    id: string;
    name: string;
    description?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    location?: string | null;
    status: string;
  }) {
    setEditTarget({ id: ev.id });
    setFormName(ev.name);
    setFormDescription(ev.description ?? "");
    setFormStartDate(ev.startDate ? new Date(ev.startDate).toISOString().slice(0, 16) : "");
    setFormEndDate(ev.endDate ? new Date(ev.endDate).toISOString().slice(0, 16) : "");
    setFormLocation(ev.location ?? "");
    setFormStatus(ev.status as EventStatus);
    setError("");
    setIsOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (editTarget) {
      updateMutation.mutate({
        id: editTarget.id,
        name: formName,
        description: formDescription || undefined,
        startDate: formStartDate ? new Date(formStartDate).toISOString() : null,
        endDate: formEndDate ? new Date(formEndDate).toISOString() : null,
        location: formLocation || null,
        status: formStatus,
      });
    } else {
      createMutation.mutate({
        name: formName,
        description: formDescription || undefined,
        startDate: formStartDate ? new Date(formStartDate).toISOString() : undefined,
        endDate: formEndDate ? new Date(formEndDate).toISOString() : undefined,
        location: formLocation || undefined,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Events</h1>
            <p className="text-text-secondary text-sm mt-1">
              Manage conference events within your tenant
            </p>
          </div>
          <button
            id="btn-create-event"
            onClick={openCreate}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            Create Event
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-text-secondary">Loading events...</div>
        ) : (
          <div className="grid gap-4">
            {(events ?? []).map((ev) => (
              <div key={ev.id} className="bg-bg-secondary border border-border-soft rounded-xl p-5 shadow-hard hover:shadow-hard-hover transition group">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-base font-bold text-text-primary truncate">{ev.name}</h2>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shadow-hard-sm ${STATUS_COLORS[ev.status as EventStatus]}`}>
                        {STATUS_LABELS[ev.status as EventStatus]}
                      </span>
                    </div>
                    {ev.description && (
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{ev.description}</p>
                    )}
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-text-muted">
                      {ev.startDate && <span>Start: {new Date(ev.startDate).toLocaleDateString()}</span>}
                      {ev.endDate && <span>End: {new Date(ev.endDate).toLocaleDateString()}</span>}
                      {ev.location && <span>📍 {ev.location}</span>}
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-text-secondary">
                      <span>{ev._count.rooms} room{ev._count.rooms !== 1 ? "s" : ""}</span>
                      <span>{ev._count.liveSessions} session{ev._count.liveSessions !== 1 ? "s" : ""}</span>
                      <span>{ev._count.presenters} presenter{ev._count.presenters !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => openEdit(ev)}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition shadow-hard-sm"
                    >
                      Edit
                    </button>
                    <Link
                      href={`/admin/events/${ev.id}/rooms`}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                    >
                      Rooms
                    </Link>
                    <Link
                      href={`/admin/events/${ev.id}/sessions`}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                    >
                      Sessions
                    </Link>
                    <Link
                      href={`/admin/events/${ev.id}/presenters`}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                    >
                      Presenters
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            {(events ?? []).length === 0 && (
              <div className="bg-bg-secondary border border-border-soft rounded-xl p-10 text-center text-text-muted shadow-hard">
                No events yet. Create the first one.
              </div>
            )}
          </div>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-bg-secondary border border-border-soft w-full max-w-lg rounded-xl p-6 shadow-hard-lg overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold text-text-primary mb-6">
              {editTarget ? "Edit Event" : "Create Event"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-name">
                  Event Name
                </label>
                <input
                  id="ev-name"
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-desc">
                  Description
                </label>
                <textarea
                  id="ev-desc"
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-start">
                    Start Date
                  </label>
                  <input
                    id="ev-start"
                    type="datetime-local"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-end">
                    End Date
                  </label>
                  <input
                    id="ev-end"
                    type="datetime-local"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-location">
                  Location
                </label>
                <input
                  id="ev-location"
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="Venue, city, or virtual"
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted"
                />
              </div>
              {editTarget && (
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-status">
                    Status
                  </label>
                  <select
                    id="ev-status"
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as EventStatus)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              )}
              {error && <p className="text-error text-xs">{error}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={resetForm}
                  className="bg-transparent hover:bg-bg-primary text-text-secondary border border-border-soft px-4 py-2 rounded-lg text-sm transition shadow-hard-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard hover:shadow-hard-hover"
                >
                  {isPending ? "Saving..." : editTarget ? "Save Changes" : "Create Event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
