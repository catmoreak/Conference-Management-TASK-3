"use client";

import { useAuth } from "~/app/_components/AuthProvider";

export default function AdminDashboard() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary px-6 py-12 text-center text-text-secondary">
      <div className="max-w-md w-full bg-bg-secondary border border-border-soft p-8 rounded-xl shadow-hard-lg">
        <h1 className="text-3xl font-extrabold text-text-primary mb-4">Administrator Dashboard</h1>
        <p className="text-sm text-text-secondary mb-8">
          Welcome to the admin console. Authorized checks are validated on each action.
        </p>

        {user && (
          <div className="bg-white border border-border-soft p-6 rounded-lg text-left space-y-4 shadow-hard-sm mb-6">
            <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Session Details</h2>
            <div>
              <p className="text-xs text-text-secondary">Authorized Name</p>
              <p className="text-sm font-bold text-text-primary mt-0.5">{user.name}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Assigned Privilege Role</p>
              <p className="text-sm font-bold text-accent-blue capitalize mt-0.5">{user.role}</p>
            </div>
          </div>
        )}

        <button
          onClick={() => void signOut()}
          className="w-full bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-accent-blue"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
