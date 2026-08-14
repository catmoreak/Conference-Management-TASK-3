"use client";

import { useEffect, useState } from "react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useRouter } from "next/navigation";
import { useLanguage } from "~/app/_components/LanguageContext";

interface Account {
  id: string;
  name: string;
  email: string;
  role: "admin" | "reviewer" | "presenter";
  status: "active" | "suspended";
  tenantId?: string | null;
  mustResetPassword: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLogin: string | null;
}

export default function AdminAccountsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang, t } = useLanguage();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Dialog state
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleSelection, setRoleSelection] = useState<"admin" | "reviewer" | "presenter">("reviewer");
  const [tenantId, setTenantId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    } else {
      void fetchAccounts();
    }
  }, [user]);

  const fetchAccounts = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/accounts", {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as Account[];
      setAccounts(data);
    } catch (err: unknown) {
      console.error(err);
      setError(lang === "ja" ? "ユーザーアカウントの読み込みに失敗しました。" : "Failed to load user accounts.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/admin/manage-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name,
          email,
          password,
          role: roleSelection,
          tenantId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? (lang === "ja" ? "アカウント作成に失敗しました。" : "Failed to create account."));
      }

      setName("");
      setEmail("");
      setPassword("");
      setTenantId("");
      setIsOpen(false);
      await fetchAccounts();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : (lang === "ja" ? "作成に失敗しました。" : "Creation failed."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (account: Account) => {
    setError("");
    const action = account.status === "active" ? "suspend" : "unsuspend";
    try {
      const res = await fetch("/api/admin/manage-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          userId: account.id,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? (lang === "ja" ? "操作に失敗しました。" : "Operation failed."));
      }

      await fetchAccounts();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : (lang === "ja" ? "ステータス更新に失敗しました。" : "Status update failed."));
    }
  };

  const handleChangeRole = async (userId: string, newRole: "admin" | "reviewer" | "presenter") => {
    setError("");
    try {
      const res = await fetch("/api/admin/manage-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change-role",
          userId,
          role: newRole,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? (lang === "ja" ? "ロール変更に失敗しました。" : "Role change failed."));
      }

      await fetchAccounts();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : (lang === "ja" ? "ロール更新に失敗しました。" : "Role update failed."));
    }
  };

  const handleMfaReset = async (userId: string) => {
    if (!confirm(lang === "ja" ? "このユーザーの2段階認証をリセットしますか？ユーザーはサインアウトされ再設定が必要になります。" : "Are you sure you want to reset this user's Multi-Factor status? They will be signed out and forced to re-enroll.")) {
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/admin/reset-mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          revokeAllSessions: true,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? (lang === "ja" ? "MFAリセットに失敗しました。" : "MFA reset failed."));
      }

      alert(lang === "ja" ? "2段階認証が正常にリセットされました。" : "Multi-Factor Authentication has been reset successfully.");
      await fetchAccounts();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : (lang === "ja" ? "MFAリセットに失敗しました。" : "MFA reset failed."));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-primary text-text-primary">
        <p className="text-lg">{lang === "ja" ? "アカウント一覧を取得中..." : "Retrieving accounts list..."}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">{t.accountsPage.title}</h1>
            <p className="text-text-secondary text-sm mt-1">{t.accountsPage.subTitle}</p>
          </div>
          <button
            onClick={() => setIsOpen(true)}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition shadow-hard hover:shadow-hard-hover active:translate-x-0.5 active:translate-y-0.5 hover:-translate-x-0.5 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-blue"
          >
            {t.accountsPage.createUser}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        {/* User list table */}
        <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">{t.accountsPage.name} / {t.accountsPage.email}</th>
                  <th className="px-6 py-4">{lang === "ja" ? "テナント範囲" : "Tenant Scope"}</th>
                  <th className="px-6 py-4">{t.accountsPage.role}</th>
                  <th className="px-6 py-4">{t.accountsPage.twoFactor}</th>
                  <th className="px-6 py-4">{t.accountsPage.status}</th>
                  <th className="px-6 py-4 text-right">{t.actions.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft text-sm">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-white transition">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-text-primary">{acc.name}</div>
                      <div className="text-xs text-text-secondary mt-0.5">{acc.email}</div>
                      {acc.lastLogin && (
                        <div className="text-[10px] text-text-muted mt-1">{lang === "ja" ? "最終確認:" : "Last seen:"} {new Date(acc.lastLogin).toLocaleString()}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-text-primary">
                      {acc.tenantId ?? <span className="text-text-muted">{lang === "ja" ? "グローバル" : "global"}</span>}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        aria-label={`Change role for ${acc.name}`}
                        value={acc.role}
                        onChange={(e) => void handleChangeRole(acc.id, e.target.value as "admin" | "reviewer" | "presenter")}
                        disabled={acc.id === user?.id}
                        className="bg-white border border-border-soft hover:border-accent-slate text-text-primary text-xs rounded-lg px-2.5 py-1.5 transition focus:outline-none focus:ring-1 focus:ring-accent-blue"
                      >
                        <option value="admin">{t.roles.admin}</option>
                        <option value="reviewer">{t.roles.reviewer}</option>
                        <option value="presenter">{t.roles.presenter}</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            acc.twoFactorEnabled ? "bg-success" : "bg-warning"
                          }`}
                          aria-hidden="true"
                        ></span>
                        <span className="text-xs text-text-primary">
                          {acc.twoFactorEnabled ? (lang === "ja" ? "設定済み" : "Enrolled") : (lang === "ja" ? "未設定" : "Not Enrolled")}
                        </span>
                        {acc.twoFactorEnabled && (
                          <button
                            onClick={() => void handleMfaReset(acc.id)}
                            className="text-xs text-error hover:text-error/80 underline focus:outline-none ml-2"
                          >
                            {lang === "ja" ? "リセット" : "Reset"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold shadow-hard-sm ${
                          acc.status === "active" ? "bg-success/10 text-success border border-success/30" : "bg-error/10 text-error border border-error/30"
                        }`}
                      >
                        {acc.status === "active" ? t.accountsPage.active : t.accountsPage.suspended}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {acc.id !== user?.id && (
                        <button
                          onClick={() => void handleToggleStatus(acc)}
                          className={`px-3 py-1.5 rounded text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg-primary shadow-hard-sm hover:shadow-hard ${
                            acc.status === "active"
                              ? "bg-error/10 hover:bg-error/20 text-error border border-error/30 focus:ring-error"
                              : "bg-success/10 hover:bg-success/20 text-success border border-success/30 focus:ring-success"
                          }`}
                        >
                          {acc.status === "active" ? t.accountsPage.suspend : t.accountsPage.unsuspend}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-bg-secondary border border-border-soft w-full max-w-md rounded-xl p-6 shadow-hard-lg">
            <h2 className="text-xl font-bold text-text-primary mb-6">{t.accountsPage.modalTitle}</h2>
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="new-name">
                  {t.accountsPage.modalNameLabel}
                </label>
                <input
                  id="new-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="new-email">
                  {t.accountsPage.modalEmailLabel}
                </label>
                <input
                  id="new-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="new-pwd">
                  {t.accountsPage.modalPasswordLabel}
                </label>
                <input
                  id="new-pwd"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="new-tenant">
                  {lang === "ja" ? "テナントID (任意)" : "Tenant Scope (UUID)"}
                </label>
                <input
                  id="new-tenant"
                  type="text"
                  required
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1" htmlFor="new-role">
                  {t.accountsPage.modalRoleLabel}
                </label>
                <select
                  id="new-role"
                  value={roleSelection}
                  onChange={(e) => setRoleSelection(e.target.value as "admin" | "reviewer" | "presenter")}
                  className="w-full bg-white border border-border-soft text-text-primary text-sm rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
                >
                  <option value="admin">{t.roles.admin}</option>
                  <option value="reviewer">{t.roles.reviewer}</option>
                  <option value="presenter">{t.roles.presenter}</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="bg-transparent hover:bg-bg-primary text-text-secondary hover:text-text-primary border border-border-soft px-4 py-2 rounded-lg text-sm transition shadow-hard-sm"
                >
                  {t.actions.cancel}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 shadow-hard hover:shadow-hard-hover active:translate-x-0.5 active:translate-y-0.5 hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  {submitting ? (lang === "ja" ? "作成中..." : "Creating...") : t.accountsPage.createUser}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
