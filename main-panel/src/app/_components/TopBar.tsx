"use client";

import { useAuth } from "~/app/_components/AuthProvider";
import { usePathname } from "next/navigation";
import { useLanguage } from "~/app/_components/LanguageContext";
import { useMobileNav } from "~/app/_components/MobileNavContext";

export function TopBar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const { lang, setLang, t } = useLanguage();
  const { toggle } = useMobileNav();

  if (!user) return null;

  // Derive dynamic page title based on pathname
  const getPageTitle = () => {
    if (pathname.includes("/admin/accounts")) return t.pageTitles.accounts;
    if (pathname.includes("/admin/sessions")) return t.pageTitles.activeSessions;
    if (pathname.includes("/admin/clients")) return t.pageTitles.clients;
    if (pathname.includes("/admin/events")) return t.pageTitles.events;
    if (pathname.includes("/audit-logs")) return t.pageTitles.auditLogs;
    if (pathname.includes("/dashboard/files")) return t.pageTitles.files;
    if (pathname.includes("/dashboard/staff")) return t.pageTitles.staff;
    if (pathname.includes("/dashboard/pres-ops")) return t.pageTitles.presOps;
    if (pathname.includes("/checkin")) return t.pageTitles.checkin;
    if (pathname.includes("/podium")) return t.pageTitles.podium;
    return t.pageTitles.dashboard;
  };

  const firstLetter = user.name ? user.name.charAt(0).toUpperCase() : "U";

  return (
    <header className="h-16 border-b border-border-soft bg-white px-4 sm:px-6 flex items-center justify-between flex-shrink-0 shadow-sm" aria-label="Header">
      {/* Left Area: Mobile Menu Toggle + Page Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggle}
          className="md:hidden p-2 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
          aria-label="Open navigation menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h2 className="text-lg sm:text-xl font-bold text-text-primary tracking-tight truncate">
          {getPageTitle()}
        </h2>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        {/* EN/JP Toggle */}
        <div className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-gray-50 text-xs">
          <button
            type="button"
            onClick={() => setLang("en")}
            className={`px-2.5 py-1 rounded font-bold transition-colors ${
              lang === "en"
                ? "bg-white border border-gray-100 shadow-sm text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLang("ja")}
            className={`px-2.5 py-1 rounded font-bold transition-colors ${
              lang === "ja"
                ? "bg-white border border-gray-100 shadow-sm text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            JP
          </button>
        </div>

        {/* Search */}
        <div className="relative w-64 hidden sm:block">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            className="w-full bg-gray-50 border border-gray-200 focus:border-[#0B1220] hover:border-gray-300 text-text-primary placeholder:text-text-muted rounded-lg pl-9 pr-4 py-1.5 text-xs transition outline-none focus:ring-2 focus:ring-[#0B1220]/5"
          />
        </div>

        {/* Bell notification */}
        <button className="p-2 text-text-secondary hover:text-text-primary hover:bg-gray-50 rounded-lg transition relative">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-gray-200"></div>

        {/* User profile & avatar */}
        <div className="flex items-center gap-3">
          <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-700 rounded-full uppercase tracking-wider">
            {t.roles[user.role as keyof typeof t.roles] ?? user.role}
          </span>
          <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
            {firstLetter}
          </div>
        </div>
      </div>
    </header>
  );
}
