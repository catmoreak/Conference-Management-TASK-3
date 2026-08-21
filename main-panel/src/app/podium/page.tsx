"use client";

import Link from "next/link";
import { useAuth } from "~/app/_components/AuthProvider";
import { useLanguage } from "~/app/_components/LanguageContext";

export default function PodiumDashboardPage() {
  const { user } = useAuth();
  const { lang, t } = useLanguage();

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary px-6 py-12 text-center text-text-secondary">
      <div className="max-w-md w-full bg-bg-secondary border border-border-soft p-8 rounded-xl shadow-hard-lg">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary mb-3">
          {lang === "ja" ? "ポディウムコンソール" : "Podium Console"}
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          {lang === "ja"
            ? "発表者用プレゼンテーション操作デッキへ移動します。"
            : "Launch the presenter operations control deck to view approved presentations and operate the podium display."}
        </p>

        <div className="mb-6">
          <Link
            href="/dashboard/pres-ops"
            className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl font-bold bg-[#0B1220] hover:bg-[#1A253C] text-white shadow-md transition"
          >
            <svg className="w-4 h-4 text-[#10B981]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
            </svg>
            <span>{lang === "ja" ? "発表者ダッシュボードを開く" : "Open Presenter Dashboard"}</span>
          </Link>
        </div>

        {user && (
          <div className="bg-white border border-border-soft p-6 rounded-lg text-left space-y-4 shadow-hard-sm">
            <h2 className="text-xs font-bold text-text-primary uppercase tracking-wider">
              {lang === "ja" ? "ユーザー詳細" : "User Details"}
            </h2>
            <div>
              <p className="text-xs text-text-secondary">{lang === "ja" ? "氏名" : "Name"}</p>
              <p className="text-sm font-bold text-text-primary mt-0.5">{user.name}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">{lang === "ja" ? "ロール" : "Role"}</p>
              <p className="text-sm font-bold text-accent-blue capitalize mt-0.5">{t.roles[user.role as keyof typeof t.roles] ?? user.role}</p>
            </div>
            {user.tenantId && (
              <div>
                <p className="text-xs text-text-secondary">{lang === "ja" ? "テナントワークスペース ID" : "Tenant Workspace ID"}</p>
                <p className="text-xs font-mono text-text-primary mt-0.5 select-all">{user.tenantId}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
