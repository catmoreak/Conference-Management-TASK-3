"use client";

import { useAuth } from "~/app/_components/AuthProvider";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navbar() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  const isActive = (path: string) => pathname === path;

  return (
    <nav className="bg-bg-secondary border-b border-border-soft text-text-primary px-6 py-4 flex items-center justify-between shadow-hard" aria-label="Main Navigation">
      <div className="flex items-center gap-8">
        <Link href="/" className="text-xl font-bold tracking-tight text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue rounded">
          Podium <span className="text-accent-blue">Console</span>
        </Link>
        <div className="flex gap-4">
          {user.role === "admin" && (
            <>
              <Link
                href="/admin/accounts"
                className={`px-3 py-2 rounded text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-blue ${
                  isActive("/admin/accounts") ? "bg-accent-blue text-white shadow-hard-sm" : "text-text-secondary hover:text-text-primary hover:bg-bg-primary"
                }`}
              >
                Accounts
              </Link>
              <Link
                href="/admin/sessions"
                className={`px-3 py-2 rounded text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-blue ${
                  isActive("/admin/sessions") ? "bg-accent-blue text-white shadow-hard-sm" : "text-text-secondary hover:text-text-primary hover:bg-bg-primary"
                }`}
              >
                Active Sessions
              </Link>
            </>
          )}
          {(user.role === "admin" || user.role === "staff") && (
            <Link
              href="/audit-logs"
              className={`px-3 py-2 rounded text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-blue ${
                isActive("/audit-logs") ? "bg-accent-blue text-white shadow-hard-sm" : "text-text-secondary hover:text-text-primary hover:bg-bg-primary"
              }`}
            >
              Audit Logs
            </Link>
          )}
          {user.role === "pres_ops_staff" && (
            <span className="text-sm bg-accent-sage/10 text-accent-sage border border-accent-sage/30 px-3 py-1.5 rounded font-medium shadow-hard-sm">
              Podium Presenter Mode
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-semibold text-text-primary">{user.name}</p>
          <p className="text-xs text-text-secondary capitalize">{user.role} role</p>
        </div>
        <button
          onClick={() => void signOut()}
          className="bg-transparent hover:bg-error/10 text-error hover:text-error border border-error/30 hover:border-error px-4 py-2 rounded text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-error shadow-hard-sm hover:shadow-hard"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
