"use client";

import { useState, useEffect } from "react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";
import { useLanguage } from "~/app/_components/LanguageContext";

type EventStatus = "draft" | "published" | "completed" | "cancelled";

const STATUS_COLORS: Record<EventStatus, string> = {
  draft: "bg-accent-slate/10 text-accent-slate border-accent-slate/30",
  published: "bg-success/10 text-success border-success/30",
  completed: "bg-accent-sage/10 text-accent-sage border-accent-sage/30",
  cancelled: "bg-error/10 text-error border-error/30",
};

export default function AdminEventsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang, t } = useLanguage();

  const [isOpen, setIsOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string } | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formStatus, setFormStatus] = useState<EventStatus>("draft");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "reviewer") {
      router.replace("/");
    }
  }, [user, router]);

  if (!user || (user.role !== "admin" && user.role !== "reviewer")) {
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

function formatForDateTimeLocal(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
    setFormStartDate(formatForDateTimeLocal(ev.startDate));
    setFormEndDate(formatForDateTimeLocal(ev.endDate));
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

  const getStatusLabel = (st: EventStatus) => {
    if (lang === "ja") {
      switch (st) {
        case "draft": return "下書き";
        case "published": return "公開済み";
        case "completed": return "終了";
        case "cancelled": return "キャンセル";
      }
    }
    switch (st) {
      case "draft": return "Draft";
      case "published": return "Published";
      case "completed": return "Completed";
      case "cancelled": return "Cancelled";
    }
  };

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">{t.eventsPage.title}</h1>
            <p className="text-text-secondary text-xs sm:text-sm mt-1">
              {t.eventsPage.subTitle}
            </p>
          </div>
          <button
            id="btn-create-event"
            onClick={openCreate}
            className="self-end sm:self-auto bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            {t.eventsPage.createEvent}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-text-secondary">{lang === "ja" ? "イベントを読み込み中..." : "Loading events..."}</div>
        ) : (
          <div className="grid gap-4">
            {(events ?? []).map((ev) => (
              <div key={ev.id} className="bg-bg-secondary border border-border-soft rounded-xl p-4 sm:p-5 shadow-hard hover:shadow-hard-hover transition group">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-base font-bold text-text-primary truncate">{ev.name}</h2>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shadow-hard-sm ${STATUS_COLORS[ev.status as EventStatus]}`}>
                        {getStatusLabel(ev.status as EventStatus)}
                      </span>
                    </div>
                    {ev.description && (
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{ev.description}</p>
                    )}
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-text-muted">
                      {ev.startDate && <span>{lang === "ja" ? "開始:" : "Start:"} {new Date(ev.startDate).toLocaleDateString()}</span>}
                      {ev.endDate && <span>{lang === "ja" ? "終了:" : "End:"} {new Date(ev.endDate).toLocaleDateString()}</span>}
                      {ev.location && <span>📍 {ev.location}</span>}
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-text-secondary">
                      <span>{ev._count.rooms} {lang === "ja" ? "会場" : "room(s)"}</span>
                      <span>{ev._count.liveSessions} {lang === "ja" ? "セッション" : "session(s)"}</span>
                      <span>{ev._count.presenters} {lang === "ja" ? "発表者" : "presenter(s)"}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
                    <button
                      onClick={() => openEdit(ev)}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition shadow-hard-sm"
                    >
                      {t.actions.edit}
                    </button>
                    <Link
                      href={`/admin/events/${ev.id}/rooms`}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                    >
                      {t.eventsPage.manageRooms}
                    </Link>
                    <Link
                      href={`/admin/events/${ev.id}/sessions`}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                    >
                      {t.eventsPage.manageSessions}
                    </Link>
                    <Link
                      href={`/admin/events/${ev.id}/presenters`}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-bg-primary hover:bg-white text-text-secondary border border-border-soft transition shadow-hard-sm"
                    >
                      {t.eventsPage.managePresenters}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            {(events ?? []).length === 0 && (
              <div className="bg-bg-secondary border border-border-soft rounded-xl p-10 text-center text-text-muted shadow-hard">
                {t.eventsPage.noEvents}
              </div>
            )}
          </div>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-bg-secondary border border-border-soft w-full max-w-lg rounded-xl p-6 shadow-hard-lg overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold text-text-primary mb-6">
              {editTarget ? (lang === "ja" ? "イベントの編集" : "Edit Event") : t.eventsPage.createEvent}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="ev-name">
                  {t.eventsPage.eventName}
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
                  {lang === "ja" ? "概要・説明" : "Description"}
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
                    {t.eventsPage.startDate}
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
                    {t.eventsPage.endDate}
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
                  {t.eventsPage.location}
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
                    {lang === "ja" ? "ステータス" : "Status"}
                  </label>
                  <select
                    id="ev-status"
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as EventStatus)}
                    className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                  >
                    <option value="draft">{getStatusLabel("draft")}</option>
                    <option value="published">{getStatusLabel("published")}</option>
                    <option value="completed">{getStatusLabel("completed")}</option>
                    <option value="cancelled">{getStatusLabel("cancelled")}</option>
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
                  {t.actions.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard hover:shadow-hard-hover"
                >
                  {isPending ? (lang === "ja" ? "保存中..." : "Saving...") : editTarget ? (lang === "ja" ? "変更を保存" : "Save Changes") : t.eventsPage.createEvent}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
