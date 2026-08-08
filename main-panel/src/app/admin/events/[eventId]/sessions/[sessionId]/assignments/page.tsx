"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";

export default function AssignmentsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ eventId: string; sessionId: string }>();
  const { eventId, sessionId } = params;

  const [isOpen, setIsOpen] = useState(false);
  const [formPresenterId, setFormPresenterId] = useState("");
  const [formSortOrder, setFormSortOrder] = useState("0");
  const [formDuration, setFormDuration] = useState("");
  const [error, setError] = useState("");

  if (!user || (user.role !== "admin" && user.role !== "staff")) {
    router.replace("/");
    return null;
  }

  const { data: session } = api.liveSession.getById.useQuery({ id: sessionId });
  const { data: presenters } = api.presenter.listByEvent.useQuery({ eventId });
  const { data: assignments, refetch, isLoading } = api.presentationAssignment.listBySession.useQuery({
    liveSessionId: sessionId,
  });

  const assignMutation = api.presentationAssignment.assign.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const unassignMutation = api.presentationAssignment.unassign.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });
  const reorderMutation = api.presentationAssignment.reorder.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setIsOpen(false);
    setFormPresenterId("");
    setFormSortOrder("0");
    setFormDuration("");
    setError("");
  }

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!formPresenterId) {
      setError("Please select a presenter");
      return;
    }
    assignMutation.mutate({
      liveSessionId: sessionId,
      presenterId: formPresenterId,
      sortOrder: parseInt(formSortOrder),
      duration: formDuration ? parseInt(formDuration) : undefined,
    });
  }

  // Presenters not yet assigned to this session
  const assignedIds = new Set((assignments ?? []).map((a) => a.presenterId));
  const availablePresenters = (presenters ?? []).filter((p) => !assignedIds.has(p.id));

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-2 flex items-center gap-3 text-xs text-accent-blue">
          <Link href={`/admin/events/${eventId}/sessions`} className="hover:underline">
            ← Back to Sessions
          </Link>
        </div>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
              Presenter Assignments
            </h1>
            <p className="text-text-secondary text-sm mt-1">
              {session ? `Session: ${session.name}` : "Loading..."}
            </p>
          </div>
          {availablePresenters.length > 0 && (
            <button
              id="btn-assign-presenter"
              onClick={() => { setError(""); setIsOpen(true); }}
              className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
            >
              Assign Presenter
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">{error}</div>
        )}

        {isLoading ? (
          <div className="py-20 text-center text-text-secondary">Loading assignments...</div>
        ) : (
          <div className="space-y-3">
            {(assignments ?? []).map((a, idx) => (
              <div key={a.id} className="bg-bg-secondary border border-border-soft rounded-xl p-5 shadow-hard flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-text-muted text-xs font-mono w-6 text-center">{idx + 1}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary">{a.presenter.displayName}</p>
                    <p className="text-xs text-text-secondary">
                      {[a.presenter.title, a.presenter.organization].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {a.duration && (
                      <p className="text-xs text-text-muted mt-0.5">{a.duration} min</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    min="0"
                    defaultValue={a.sortOrder}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val !== a.sortOrder) {
                        reorderMutation.mutate({ id: a.id, sortOrder: val });
                      }
                    }}
                    aria-label="Sort order"
                    className="w-16 bg-white border border-border-soft text-text-primary text-xs rounded px-2 py-1 focus:ring-1 focus:ring-accent-blue outline-none text-center"
                  />
                  <button
                    onClick={() => {
                      if (confirm(`Remove "${a.presenter.displayName}" from this session?`)) {
                        unassignMutation.mutate({ id: a.id });
                      }
                    }}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {(assignments ?? []).length === 0 && (
              <div className="bg-bg-secondary border border-border-soft rounded-xl p-10 text-center text-text-muted shadow-hard">
                No presenters assigned to this session yet.
              </div>
            )}
          </div>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-bg-secondary border border-border-soft w-full max-w-md rounded-xl p-6 shadow-hard-lg">
            <h2 className="text-xl font-bold text-text-primary mb-6">Assign Presenter</h2>
            <form onSubmit={handleAssign} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="assign-presenter">Presenter</label>
                <select id="assign-presenter" value={formPresenterId} onChange={(e) => setFormPresenterId(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none">
                  <option value="">— Select a presenter —</option>
                  {availablePresenters.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}{p.organization ? ` (${p.organization})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="assign-order">Sort Order</label>
                  <input id="assign-order" type="number" min="0" value={formSortOrder}
                    onChange={(e) => setFormSortOrder(e.target.value)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="assign-duration">Duration (min)</label>
                  <input id="assign-duration" type="number" min="1" value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value)} placeholder="Optional"
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted" />
                </div>
              </div>
              {error && <p className="text-error text-xs">{error}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={resetForm}
                  className="bg-transparent hover:bg-bg-primary text-text-secondary border border-border-soft px-4 py-2 rounded-lg text-sm transition shadow-hard-sm">
                  Cancel
                </button>
                <button type="submit" disabled={assignMutation.isPending}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard">
                  {assignMutation.isPending ? "Assigning..." : "Assign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
