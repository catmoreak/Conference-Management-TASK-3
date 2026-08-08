"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";

export default function PresentersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formOrganization, setFormOrganization] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [error, setError] = useState("");

  if (!user || (user.role !== "admin" && user.role !== "staff")) {
    router.replace("/");
    return null;
  }

  const { data: event } = api.event.getById.useQuery({ id: eventId });
  const { data: presenters, refetch, isLoading } = api.presenter.listByEvent.useQuery({ eventId });

  const createMutation = api.presenter.create.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const updateMutation = api.presenter.update.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const deleteMutation = api.presenter.delete.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setIsOpen(false);
    setEditId(null);
    setFormDisplayName("");
    setFormOrganization("");
    setFormTitle("");
    setFormNotes("");
    setError("");
  }

  function openCreate() {
    resetForm();
    setIsOpen(true);
  }

  function openEdit(p: {
    id: string;
    displayName: string;
    organization: string | null;
    title: string | null;
    notes: string | null;
  }) {
    setEditId(p.id);
    setFormDisplayName(p.displayName);
    setFormOrganization(p.organization ?? "");
    setFormTitle(p.title ?? "");
    setFormNotes(p.notes ?? "");
    setError("");
    setIsOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (editId) {
      updateMutation.mutate({
        id: editId,
        displayName: formDisplayName,
        organization: formOrganization || null,
        title: formTitle || null,
        notes: formNotes || null,
      });
    } else {
      createMutation.mutate({
        eventId,
        displayName: formDisplayName,
        organization: formOrganization || undefined,
        title: formTitle || undefined,
        notes: formNotes || undefined,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-2">
          <Link href="/admin/events" className="text-xs text-accent-blue hover:underline">
            ← Back to Events
          </Link>
        </div>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Presenters</h1>
            <p className="text-text-secondary text-sm mt-1">
              {event ? `Event: ${event.name}` : "Loading..."} — no PII fields stored
            </p>
          </div>
          <button
            id="btn-create-presenter"
            onClick={openCreate}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            Add Presenter
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">{error}</div>
        )}

        {isLoading ? (
          <div className="py-20 text-center text-text-secondary">Loading presenters...</div>
        ) : (
          <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Organization</th>
                  <th className="px-6 py-4">Title</th>
                  <th className="px-6 py-4">Assignments</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft text-sm">
                {(presenters ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-white transition">
                    <td className="px-6 py-4 font-semibold text-text-primary">{p.displayName}</td>
                    <td className="px-6 py-4 text-text-secondary">{p.organization ?? "—"}</td>
                    <td className="px-6 py-4 text-text-secondary">{p.title ?? "—"}</td>
                    <td className="px-6 py-4 text-text-secondary">{p._count.presentationAssignments}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition shadow-hard-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remove presenter "${p.displayName}"? Unassign from all sessions first.`)) {
                              deleteMutation.mutate({ id: p.id });
                            }
                          }}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(presenters ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-text-muted">No presenters yet for this event.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-bg-secondary border border-border-soft w-full max-w-md rounded-xl p-6 shadow-hard-lg">
            <h2 className="text-xl font-bold text-text-primary mb-1">{editId ? "Edit Presenter" : "Add Presenter"}</h2>
            <p className="text-xs text-text-muted mb-6">No email or phone fields — PII excluded per FR-EVT-003</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-name">Display Name</label>
                <input id="pres-name" type="text" required value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-org">Organization</label>
                <input id="pres-org" type="text" value={formOrganization}
                  onChange={(e) => setFormOrganization(e.target.value)} placeholder="Optional"
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-title">Title / Role</label>
                <input id="pres-title" type="text" value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)} placeholder="Optional"
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-notes">Internal Notes</label>
                <textarea id="pres-notes" rows={2} value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)} placeholder="Staff-only notes (not shown to presenter)"
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted" />
              </div>
              {error && <p className="text-error text-xs">{error}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={resetForm}
                  className="bg-transparent hover:bg-bg-primary text-text-secondary border border-border-soft px-4 py-2 rounded-lg text-sm transition shadow-hard-sm">
                  Cancel
                </button>
                <button type="submit" disabled={isPending}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard">
                  {isPending ? "Saving..." : editId ? "Save" : "Add Presenter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
