"use client";

import { useAuth } from "~/app/_components/AuthProvider";

export default function PodiumDashboardPage() {
  const { user } = useAuth();

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary px-6 py-12 text-center text-text-secondary">
      <div className="max-w-md w-full bg-bg-secondary border border-border-soft p-8 rounded-xl shadow-hard-lg">
        <h1 className="text-3xl font-extrabold text-text-primary mb-4">Podium Console</h1>
        <p className="text-sm text-text-secondary mb-8">
          Welcome to the presentation delivery interface. Authorized checks are validated on each action.
        </p>

        {user && (
          <div className="bg-white border border-border-soft p-6 rounded-lg text-left space-y-4 shadow-hard-sm">
            <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Session Details</h2>
            <div>
              <p className="text-xs text-text-secondary">Authorized Name</p>
              <p className="text-sm font-bold text-text-primary mt-0.5">{user.name}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Assigned Privilege Role</p>
              <p className="text-sm font-bold text-accent-blue capitalize mt-0.5">{user.role}</p>
            </div>
            {user.tenantId && (
              <div>
                <p className="text-xs text-text-secondary">Tenant Workspace ID</p>
                <p className="text-xs font-mono text-text-primary mt-0.5 select-all">{user.tenantId}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
