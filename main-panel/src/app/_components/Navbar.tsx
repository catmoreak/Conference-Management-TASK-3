"use client";

import { useAuth } from "~/app/_components/AuthProvider";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "~/app/_components/LanguageContext";
import { useMobileNav } from "~/app/_components/MobileNavContext";

export function Navbar() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const { t } = useLanguage();
  const { isOpen, close } = useMobileNav();

  if (!user) return null;

  const isActive = (path: string) => pathname === path || (path !== "/" && pathname.startsWith(path));

  const navContent = (
    <div className="flex flex-col justify-between h-full">
      {/* Top Brand Area */}
      <div className="p-6 flex items-center justify-between">
        <Link
          href="/"
          onClick={close}
          className="flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-[#10B981] rounded-lg"
        >
          <div className="w-8 h-8 bg-[#10B981] rounded-lg flex items-center justify-center text-white">
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="text-left">
            <span className="font-bold text-lg text-gray-900 block leading-none">{t.brand}</span>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{t.console}</span>
          </div>
        </Link>
        {/* Mobile Close Button */}
        <button
          onClick={close}
          className="md:hidden p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

        {/* Navigation Area */}
        <div className="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto">
          {user.role === "admin" && (
            <>
              <Link
                href="/admin/accounts"
                onClick={close}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#10B981] ${
                  isActive("/admin/accounts") ? "bg-[#F1F5F9] text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <svg className={`w-5 h-5 ${isActive("/admin/accounts") ? "text-[#10B981]" : "text-gray-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                {t.nav.accounts}
              </Link>
              <Link
                href="/admin/sessions"
                onClick={close}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#10B981] ${
                  isActive("/admin/sessions") ? "bg-[#F1F5F9] text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <svg className={`w-5 h-5 ${isActive("/admin/sessions") ? "text-[#10B981]" : "text-gray-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {t.nav.activeSessions}
              </Link>
              <Link
                href="/admin/clients"
                onClick={close}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#10B981] ${
                  isActive("/admin/clients") ? "bg-[#F1F5F9] text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <svg className={`w-5 h-5 ${isActive("/admin/clients") ? "text-[#10B981]" : "text-gray-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {t.nav.clients}
              </Link>
            </>
          )}
          {(user.role === "admin" || user.role === "reviewer") && (
            <Link
              href="/admin/events"
              onClick={close}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#10B981] ${
                isActive("/admin/events") ? "bg-[#F1F5F9] text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <svg className={`w-5 h-5 ${isActive("/admin/events") ? "text-[#10B981]" : "text-gray-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              {t.nav.events}
            </Link>
          )}
          <Link
            href="/dashboard/files"
            onClick={close}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#10B981] ${
              isActive("/dashboard/files") ? "bg-[#F1F5F9] text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <svg className={`w-5 h-5 ${isActive("/dashboard/files") ? "text-[#10B981]" : "text-gray-400"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20" />
            </svg>
            {t.nav.files}
          </Link>
          {user.role === "presenter" && (
            <div className="mt-4 px-4 py-2 bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl text-xs font-semibold text-[#10B981] shadow-sm">
              {t.presenterModeHint}
            </div>
          )}
        </div>

        {/* Bottom Profile Area */}
        <div className="p-4 border-t border-gray-100 space-y-4 bg-gray-50/50">
          <div className="px-2 text-left">
            <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
            <span className="inline-block mt-2 px-2 py-0.5 text-[10px] font-bold bg-[#10B981]/15 text-[#10B981] rounded-full uppercase tracking-wider">
              {t.roles[user.role as keyof typeof t.roles] ?? user.role}
            </span>
          </div>
          <button
            onClick={() => void signOut()}
            className="w-full flex items-center justify-center gap-2 bg-[#0B1220] hover:bg-[#1A253C] text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition focus:outline-none focus:ring-2 focus:ring-[#0B1220]"
          >
            <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {t.signOut}
          </button>
        </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex w-64 bg-white text-gray-500 flex-col justify-between h-screen sticky top-0 flex-shrink-0 border-r border-gray-200"
        aria-label="Main Navigation"
      >
        {navContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={close}
            aria-hidden="true"
          />
          {/* Drawer Sheet */}
          <div className="relative w-72 max-w-[85vw] bg-white h-full shadow-2xl z-10 flex flex-col">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}
