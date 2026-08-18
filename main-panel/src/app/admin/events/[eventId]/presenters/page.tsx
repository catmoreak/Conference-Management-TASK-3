"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useLanguage } from "~/app/_components/LanguageContext";

export default function PresentersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const { lang, t } = useLanguage();

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formBio, setFormBio] = useState("");
  const [formStatus, setFormStatus] = useState<"active" | "inactive">("active");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || (user.role !== "admin" && user.role !== "reviewer")) {
      router.replace("/");
    }
  }, [user, router]);

  if (!user || (user.role !== "admin" && user.role !== "reviewer")) {
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
    setFormName("");
    setFormEmail("");
    setFormBio("");
    setFormStatus("active");
    setError("");
  }

  function openCreate() {
    resetForm();
    setIsOpen(true);
  }

  function openEdit(p: {
    id: string;
    name: string;
    email: string;
    bio?: string | null;
    status: string;
  }) {
    setEditId(p.id);
    setFormName(p.name);
    setFormEmail(p.email);
    setFormBio(p.bio ?? "");
    setFormStatus(p.status === "active" || p.status === "inactive" ? p.status : "inactive");
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
        email: formEmail,
        bio: formBio || null,
        status: formStatus,
      });
    } else {
      createMutation.mutate({
        eventId,
        name: formName,
        email: formEmail,
        bio: formBio || undefined,
        status: formStatus,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-2">
          <Link href="/admin/events" className="text-xs text-accent-blue hover:underline">
            ← {lang === "ja" ? "イベント一覧へ戻る" : "Back to Events"}
          </Link>
        </div>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">{t.eventsPage.managePresenters}</h1>
            <p className="text-text-secondary text-sm mt-1">
              {event ? `${lang === "ja" ? "対象イベント:" : "Event:"} ${event.name}` : (lang === "ja" ? "読み込み中..." : "Loading...")}
            </p>
          </div>
          <button
            id="btn-create-presenter"
            onClick={openCreate}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            {lang === "ja" ? "発表者を追加" : "Add Presenter"}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">{error}</div>
        )}

        {isLoading ? (
          <div className="py-20 text-center text-text-secondary">{lang === "ja" ? "発表者一覧を読み込み中..." : "Loading presenters..."}</div>
        ) : (
          <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">{t.accountsPage.name}</th>
                  <th className="px-6 py-4">{t.accountsPage.status}</th>
                  <th className="px-6 py-4">{lang === "ja" ? "担当セッション数" : "Assignments"}</th>
                  <th className="px-6 py-4 text-right">{t.actions.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft text-sm">
                {(presenters ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-white transition">
                    <td className="px-6 py-4 font-semibold text-text-primary">{p.name}</td>
                    <td className="px-6 py-4 text-text-secondary">{p.status === "active" ? t.accountsPage.active : p.status}</td>
                    <td className="px-6 py-4 text-text-secondary">{p._count?.presentationAssignments ?? 0}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 transition shadow-hard-sm"
                        >
                          {t.actions.edit}
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(lang === "ja" ? `発表者 "${p.name}" を削除しますか？` : `Remove presenter "${p.name}"? Unassign from all sessions first.`)) {
                              deleteMutation.mutate({ id: p.id });
                            }
                          }}
                          className="px-3 py-1.5 rounded text-xs font-semibold bg-error/10 hover:bg-error/20 text-error border border-error/30 transition shadow-hard-sm"
                        >
                          {lang === "ja" ? "削除" : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(presenters ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-text-muted">{lang === "ja" ? "このイベントには発表者がまだ登録されていません。" : "No presenters yet for this event."}</td>
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
            <h2 className="text-xl font-bold text-text-primary mb-1">{editId ? (lang === "ja" ? "発表者の編集" : "Edit Presenter") : (lang === "ja" ? "発表者の追加" : "Add Presenter")}</h2>
            <p className="text-xs text-text-muted mb-6">{lang === "ja" ? "各セッションの発表者情報を最新に維持します。" : "Keep presenter identity and event contact data aligned with each session."}</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-name">{t.accountsPage.name}</label>
                <input id="pres-name" type="text" required value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-email">{t.accountsPage.email}</label>
                <input id="pres-email" type="email" required value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-status">{t.accountsPage.status}</label>
                <select id="pres-status" value={formStatus} onChange={(e) => setFormStatus(e.target.value as "active" | "inactive")}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none">
                  <option value="active">{t.accountsPage.active}</option>
                  <option value="inactive">{lang === "ja" ? "無効" : "inactive"}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="pres-bio">{lang === "ja" ? "プロフィール・略歴" : "Bio"}</label>
                <textarea id="pres-bio" rows={2} value={formBio}
                  onChange={(e) => setFormBio(e.target.value)} placeholder={lang === "ja" ? "略歴 (任意)" : "Optional bio"}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted" />
              </div>
              {error && <p className="text-error text-xs">{error}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={resetForm}
                  className="bg-transparent hover:bg-bg-primary text-text-secondary border border-border-soft px-4 py-2 rounded-lg text-sm transition shadow-hard-sm">
                  {t.actions.cancel}
                </button>
                <button type="submit" disabled={isPending}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard">
                  {isPending ? (lang === "ja" ? "保存中..." : "Saving...") : editId ? t.actions.save : (lang === "ja" ? "発表者を追加" : "Add Presenter")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
