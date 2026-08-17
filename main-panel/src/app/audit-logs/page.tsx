"use client";

import { useEffect, useState } from "react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useRouter } from "next/navigation";
import { useLanguage } from "~/app/_components/LanguageContext";

interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  user_agent: string | null;
  occurred_at: string;
  result: string;
  metadata: Record<string, unknown> | null;
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang, t } = useLanguage();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [actorIdFilter, setActorIdFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");

  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "reviewer") {
      router.replace("/");
    } else {
      void fetchLogs();
    }
  }, [user]);

  const fetchLogs = async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (actorIdFilter) params.append("actorId", actorIdFilter);
      if (actionFilter) params.append("action", actionFilter);
      if (startDateFilter) params.append("startDate", new Date(startDateFilter).toISOString());
      if (endDateFilter) params.append("endDate", new Date(endDateFilter).toISOString());

      const res = await fetch(`/api/audit?${params.toString()}`, {
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = (await res.json()) as AuditLog[];
      setLogs(data);
    } catch (err: unknown) {
      console.error(err);
      setError(lang === "ja" ? "監査ログの取得に失敗しました。" : "Failed to retrieve audit log listings.");
    } finally {
      setLoading(false);
    }
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchLogs();
  };

  const handleResetFilters = () => {
    setActorIdFilter("");
    setActionFilter("");
    setStartDateFilter("");
    setEndDateFilter("");
    setTimeout(() => void fetchLogs(), 0);
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-primary text-text-primary">
        <p className="text-lg">{lang === "ja" ? "セキュリティ監査ログを取得中..." : "Retrieving security audit trail..."}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">{t.auditLogsPage.title}</h1>
            <p className="text-text-secondary text-xs sm:text-sm mt-1">{t.auditLogsPage.subTitle}</p>
          </div>
          <button
            onClick={() => void fetchLogs()}
            className="self-end sm:self-auto bg-bg-secondary hover:bg-white text-text-primary border border-border-soft font-semibold px-4 py-2.5 rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-accent-blue shadow-hard hover:shadow-hard-hover"
          >
            {t.actions.refresh}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        {/* Filter Controls */}
        <form onSubmit={handleFilterSubmit} className="bg-bg-secondary border border-border-soft rounded-xl p-4 sm:p-6 mb-6 shadow-hard">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5" htmlFor="filter-actor">
                {lang === "ja" ? "実行者 ID (Actor)" : "Actor User ID"}
              </label>
              <input
                id="filter-actor"
                type="text"
                value={actorIdFilter}
                onChange={(e) => setActorIdFilter(e.target.value)}
                placeholder="UUID"
                className="w-full bg-white border border-border-soft text-text-primary text-xs rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5" htmlFor="filter-action">
                {lang === "ja" ? "操作種別 (Action)" : "Action Type"}
              </label>
              <input
                id="filter-action"
                type="text"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                placeholder="e.g. LOGIN_SUCCESS"
                className="w-full bg-white border border-border-soft text-text-primary text-xs rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none placeholder:text-text-muted"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5" htmlFor="filter-start">
                {t.eventsPage.startDate}
              </label>
              <input
                id="filter-start"
                type="datetime-local"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="w-full bg-white border border-border-soft text-text-primary text-xs rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5" htmlFor="filter-end">
                {t.eventsPage.endDate}
              </label>
              <input
                id="filter-end"
                type="datetime-local"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="w-full bg-white border border-border-soft text-text-primary text-xs rounded-lg px-3 py-2 transition focus:ring-2 focus:ring-accent-blue outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleResetFilters}
              className="bg-transparent hover:bg-white text-text-secondary hover:text-text-primary border border-border-soft px-4 py-2 rounded-lg text-xs font-semibold transition shadow-hard-sm"
            >
              {lang === "ja" ? "フィルターリセット" : "Reset Filters"}
            </button>
            <button
              type="submit"
              className="bg-accent-blue hover:bg-accent-blue/90 text-white px-4 py-2 rounded-lg text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent-blue shadow-hard hover:shadow-hard-hover active:translate-x-0.5 active:translate-y-0.5 hover:-translate-x-0.5 hover:-translate-y-0.5"
            >
              {t.actions.filter}
            </button>
          </div>
        </form>

        {/* Audit Logs Table */}
        <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">{t.auditLogsPage.timestamp}</th>
                  <th className="px-6 py-4">{t.auditLogsPage.user}</th>
                  <th className="px-6 py-4">{t.auditLogsPage.action}</th>
                  <th className="px-6 py-4">{t.auditLogsPage.target}</th>
                  <th className="px-6 py-4">{t.auditLogsPage.ipAddress}</th>
                  <th className="px-6 py-4">{t.staffDashboard.status}</th>
                  <th className="px-6 py-4">{t.auditLogsPage.details}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft text-xs">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-text-muted text-sm bg-white">
                      {t.auditLogsPage.noLogs}
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-white transition bg-bg-secondary">
                      <td className="px-6 py-4 text-text-primary font-mono">
                        {new Date(log.occurred_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-text-primary font-mono">{log.actor_id ?? (lang === "ja" ? "システム" : "SYSTEM")}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono bg-white text-accent-blue px-2 py-1 rounded border border-border-soft shadow-hard-sm">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {log.target_type ? (
                          <>
                            <div className="text-text-primary capitalize">{log.target_type}</div>
                            <div className="text-[10px] text-text-secondary font-mono mt-0.5">{log.target_id}</div>
                          </>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 max-w-xs truncate" title={log.user_agent ?? ""}>
                        <div className="font-mono text-text-primary">{log.ip ?? "unknown"}</div>
                        <div className="text-[10px] text-text-secondary truncate mt-0.5">{log.user_agent ?? "unknown"}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase shadow-hard-sm ${
                            log.result.startsWith("success")
                              ? "bg-success/10 text-success border border-success/30"
                              : "bg-error/10 text-error border border-error/30"
                          }`}
                        >
                          {log.result}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        {log.metadata ? (
                          <pre
                            className="font-mono text-[10px] text-text-secondary truncate"
                            title={JSON.stringify(log.metadata, null, 2)}
                          >
                            {JSON.stringify(log.metadata)}
                          </pre>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
