"use client";

import { useAuth } from "~/app/_components/AuthProvider";

export default function AdminDashboard() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex-1 bg-[#F8FAFC] p-8 flex items-center justify-center">
      <div className="max-w-md w-full bg-white border border-gray-200 p-8 rounded-xl shadow-sm text-center">
        <h1 className="text-2xl font-bold text-[#0B1220] mb-2">Administrator Dashboard</h1>
        <p className="text-xs text-gray-500 mb-8">
          Welcome to the Podium admin console. Authorized checks are validated on each action.
        </p>

        {user && (
          <div className="bg-gray-50 border border-gray-100 p-6 rounded-xl text-left space-y-4 mb-6">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Session Details</h2>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Authorized Name</p>
              <p className="text-sm font-semibold text-[#0B1220] mt-0.5">{user.name}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Assigned Privilege Role</p>
              <div className="mt-1">
                <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold bg-[#10B981]/15 text-[#10B981] rounded-full uppercase tracking-wider">
                  {user.role}
                </span>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => void signOut()}
          className="w-full bg-[#0B1220] hover:bg-[#1A253C] text-white font-semibold py-2.5 px-4 rounded-xl text-sm transition focus:outline-none focus:ring-2 focus:ring-[#0B1220]"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
