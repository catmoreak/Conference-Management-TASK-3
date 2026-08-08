"use client";

import { useState } from "react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

type ClientStatus = "active" | "suspended";

export default function AdminClientsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: string;
    name: string;
    status: ClientStatus;
  } | null>(null);
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formStatus, setFormStatus] = useState<ClientStatus>("active");
  const [error, setError] = useState("");

  if (user?.role !== "admin") {
    router.replace("/");
    return null;
  }

  const { data: clients, refetch, isLoading } = api.clients.list.useQuery();

  const createMutation = api.clients.create.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const updateMutation = api.clients.update.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setIsOpen(false);
    setEditTarget(null);
    setFormName("");
    setFormSlug("");
    setFormStatus("active");
    setError("");
  }

  function openCreate() {
    setEditTarget(null);
    setFormName("");
    setFormSlug("");
    setFormStatus("active");
    setError("");
    setIsOpen(true);
  }

  function openEdit(c: { id: string; name: string; status: string }) {
    setEditTarget({ id: c.id, name: c.name, status: c.status as ClientStatus });
    setFormName(c.name);
    setFormStatus(c.status as ClientStatus);
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
        status: formStatus,
      });
    } else {
      createMutation.mutate({ name: formName, slug: formSlug });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
              Client Management
            </h1>
            <p className="text-text-secondary text-sm mt-1">
              Manage conference clients (tenants) and their status
            </p>
          </div>
          <button
            id="btn-create-client"
            onClick={openCreate}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            Add Client
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-text-secondary">
            Loading clients...
          </div>
        ) : (
          <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                    <th className="px-6 py-4">Name</th>
                    <th className="px-6 py-4">Slug</th>
                    <th className="px-6 py-4">Events</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Created</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft text-sm">
                  {(clients ?? []).map((c) => (
                    <tr key={c.id} className="hover:bg-white transition">
                      <td className="px-6 py-4 font-semibold text-text-primary">{c.name}</td>
                      <td className="px-6 py-4 font-mono text-xs text-text-secondary">{c.slug}</td>
                      <td className="px-6 py-4 text-text-secondary">{c._count.events}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold shadow-hard-sm ${
                            c.status === "active"
                              ? "bg-success/10 text-success border border-success/30"
                              : "bg-error/10 text-error border border-error/30"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-text-muted">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(c)}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition focus:outline-none focus:ring-2 focus:ring-accent-blue shadow-hard-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => router.push(`/admin/events?clientId=${c.id}`)}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-sage/10 hover:bg-accent-sage/20 text-accent-sage border border-accent-sage/30 transition shadow-hard-sm focus:outline-none"
                        >
                          Events
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(clients ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-text-muted">
                        No clients yet. Add the first one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-bg-secondary border border-border-soft w-full max-w-md rounded-xl p-6 shadow-hard-lg">
            <h2 className="text-xl font-bold text-text-primary mb-6">
              {editTarget ? "Edit Client" : "Add Client"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="client-name">
                  Client Name
                </label>
                <input
                  id="client-name"
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                />
              </div>
              {!editTarget && (
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="client-slug">
                    Slug (lowercase, hyphens only)
                  </label>
                  <input
                    id="client-slug"
                    type="text"
                    required
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="e.g. acme-corp-2026"
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted"
                  />
                </div>
              )}
              {editTarget && (
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="client-status">
                    Status
                  </label>
                  <select
                    id="client-status"
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as ClientStatus)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              )}
              {error && (
                <p className="text-error text-xs">{error}</p>
              )}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={resetForm}
                  className="bg-transparent hover:bg-bg-primary text-text-secondary hover:text-text-primary border border-border-soft px-4 py-2 rounded-lg text-sm transition shadow-hard-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard hover:shadow-hard-hover"
                >
                  {isPending ? "Saving..." : editTarget ? "Save Changes" : "Create Client"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
