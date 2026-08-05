"use client";

import { useEffect, useState } from "react";
import { useAuth } from "~/app/_components/AuthProvider";
import { useRouter } from "next/navigation";

interface ActiveSession {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  lastActive: string;
}

export default function AdminSessionsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    } else {
      void fetchSessions();
    }
  }, [user]);

  const fetchSessions = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/sessions", {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as ActiveSession[];
      setSessions(data);
    } catch (err: unknown) {
      console.error(err);
      setError("Failed to retrieve active session logs.");
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!confirm("Are you sure you want to terminate this session? The device will be logged out instantly.")) {
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/admin/revoke-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "one",
          sessionId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to revoke session.");
      }

      await fetchSessions();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Revocation failed.");
    }
  };

  const handleRevokeAll = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to terminate ALL active sessions for ${userName}?`)) {
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/admin/revoke-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "all",
          userId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to revoke all sessions.");
      }

      await fetchSessions();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Batch revocation failed.");
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-primary text-text-primary">
        <p className="text-lg">Retrieving active sessions...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-bg-primary text-text-secondary p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Active Sessions</h1>
            <p className="text-text-secondary text-sm mt-1">Monitor and revoke real-time user browser & device connections</p>
          </div>
          <button
            onClick={() => void fetchSessions()}
            className="bg-bg-secondary hover:bg-white text-text-primary border border-border-soft font-semibold px-4 py-2.5 rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-accent-blue shadow-hard hover:shadow-hard-hover"
          >
            Refresh Sessions
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm" role="alert">
            {error}
          </div>
        )}

        <div className="bg-bg-secondary border border-border-soft rounded-xl overflow-hidden shadow-hard-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-border-soft text-text-secondary text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">IP Address</th>
                  <th className="px-6 py-4">Browser / Device (User Agent)</th>
                  <th className="px-6 py-4">Last Active</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft text-sm">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-white transition">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-text-primary">{s.name}</div>
                      <div className="text-xs text-text-secondary mt-0.5">{s.email}</div>
                      <span className="inline-block bg-white text-text-primary text-[10px] uppercase font-semibold px-2 py-0.5 rounded mt-1.5 border border-border-soft shadow-hard-sm">
                        {s.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-text-primary">
                      {s.ipAddress ?? <span className="text-text-muted">unknown</span>}
                    </td>
                    <td className="px-6 py-4 text-xs text-text-primary max-w-xs truncate" title={s.userAgent ?? ""}>
                      {s.userAgent ?? <span className="text-text-muted">unknown</span>}
                    </td>
                    <td className="px-6 py-4 text-xs text-text-primary">
                      <div>{new Date(s.lastActive).toLocaleString()}</div>
                      <div className="text-[10px] text-text-muted mt-0.5">Expires: {new Date(s.expiresAt).toLocaleTimeString()}</div>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => void handleRevokeSession(s.id)}
                        className="bg-transparent hover:bg-error/10 text-error hover:text-error border border-error/30 hover:border-error px-3 py-1.5 rounded text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-error shadow-hard-sm hover:shadow-hard"
                      >
                        Revoke
                      </button>
                      <button
                        onClick={() => void handleRevokeAll(s.userId, s.name)}
                        className="bg-transparent hover:bg-error/20 text-error hover:text-error border border-error/50 hover:border-error px-3 py-1.5 rounded text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-error shadow-hard-sm hover:shadow-hard"
                      >
                        Revoke All For User
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
