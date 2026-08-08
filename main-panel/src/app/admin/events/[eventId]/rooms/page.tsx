"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";

export default function RoomsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formCapacity, setFormCapacity] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formSortOrder, setFormSortOrder] = useState("0");
  const [error, setError] = useState("");

  if (!user || (user.role !== "admin" && user.role !== "staff")) {
    router.replace("/");
    return null;
  }

  const { data: event } = api.event.getById.useQuery({ id: eventId });
  const { data: rooms, refetch, isLoading } = api.room.listByEvent.useQuery({ eventId });

  const createMutation = api.room.create.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const updateMutation = api.room.update.useMutation({
    onSuccess: () => { void refetch(); resetForm(); },
    onError: (e) => setError(e.message),
  });
  const deleteMutation = api.room.delete.useMutation({
    onSuccess: () => void refetch(),
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setIsOpen(false);
    setEditId(null);
    setFormName("");
    setFormCapacity("");
    setFormLocation("");
    setFormSortOrder("0");
    setError("");
  }

  function openCreate() {
    setEditId(null);
    setFormName("");
    setFormCapacity("");
    setFormLocation("");
    setFormSortOrder("0");
    setError("");
    setIsOpen(true);
  }

  function openEdit(r: { id: string; name: string; capacity: number | null; location: string | null; sortOrder: number }) {
    setEditId(r.id);
    setFormName(r.name);
    setFormCapacity(r.capacity?.toString() ?? "");
    setFormLocation(r.location ?? "");
    setFormSortOrder(r.sortOrder.toString());
    setError("");
    setIsOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const cap = formCapacity ? parseInt(formCapacity) : undefined;
    if (editId) {
      updateMutation.mutate({
        id: editId,
        name: formName,
        capacity: cap ?? null,
        location: formLocation || null,
        sortOrder: parseInt(formSortOrder),
      });
    } else {
      createMutation.mutate({
        eventId,
        name: formName,
        capacity: cap,
        location: formLocation || undefined,
        sortOrder: parseInt(formSortOrder),
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
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Rooms</h1>
            <p className="text-text-secondary text-sm mt-1">
              {event ? `Event: ${event.name}` : "Loading..."}
            </p>
          </div>
          <button
            id="btn-create-room"
            onClick={openCreate}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            Add Room
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">{error}</div>
        )}

        {isLoading ? (
          <div className="py-20 text-center text-text-secondary">Loading rooms...</div>
        ) : (
          <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">Room Name</th>
                  <th className="px-6 py-4">Capacity</th>
                  <th className="px-6 py-4">Location</th>
                  <th className="px-6 py-4">Sessions</th>
                  <th className="px-6 py-4">Order</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft text-sm">
                {(rooms ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-white transition">
                    <td className="px-6 py-4 font-semibold text-text-primary">{r.name}</td>
                    <td className="px-6 py-4 text-text-secondary">{r.capacity ?? "—"}</td>
                    <td className="px-6 py-4 text-text-secondary">{r.location ?? "—"}</td>
                    <td className="px-6 py-4 text-text-secondary">{r._count.liveSessions}</td>
                    <td className="px-6 py-4 text-text-muted">{r.sortOrder}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(r)}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition shadow-hard-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete room "${r.name}"? This cannot be undone.`)) {
                              deleteMutation.mutate({ id: r.id });
                            }
                          }}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(rooms ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-text-muted">No rooms yet for this event.</td>
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
            <h2 className="text-xl font-bold text-text-primary mb-6">{editId ? "Edit Room" : "Add Room"}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="room-name">Room Name</label>
                <input id="room-name" type="text" required value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="room-cap">Capacity</label>
                  <input id="room-cap" type="number" min="1" value={formCapacity}
                    onChange={(e) => setFormCapacity(e.target.value)} placeholder="Optional"
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="room-order">Sort Order</label>
                  <input id="room-order" type="number" min="0" value={formSortOrder}
                    onChange={(e) => setFormSortOrder(e.target.value)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="room-loc">Location</label>
                <input id="room-loc" type="text" value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)} placeholder="e.g. Hall A, Floor 2"
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
                  {isPending ? "Saving..." : editId ? "Save" : "Add Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
