"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { authClient } from "~/server/better-auth/client";

// Define a type for user context matching our DB schema additions
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "staff" | "pres_ops_staff";
  status: "active" | "suspended";
  tenantId?: string | null;
  mustResetPassword: boolean;
  twoFactorEnabled: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  refetch: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refetch: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Define verification call using Better Auth client SDK
  const verifySession = async () => {
    try {
      const res = await authClient.getSession();
      if (res.data?.user) {
        const u = res.data.user as unknown as AuthUser;
        setUser(u);

        // Reactively redirect to onboarding if required and not already there
        if ((u.mustResetPassword || !u.twoFactorEnabled) && !pathname.startsWith("/auth/onboarding")) {
          router.replace("/auth/onboarding");
        }
      } else {
        setUser(null);
        // Reactive redirect to login on unauthenticated
        if (!pathname.startsWith("/auth/login")) {
          router.replace("/auth/login");
        }
      }
    } catch (err) {
      console.error("Error retrieving session:", err);
      setUser(null);
      if (!pathname.startsWith("/auth/login")) {
        router.replace("/auth/login");
      }
    } finally {
      setLoading(false);
    }
  };

  // Reactively track authentication status using Better Auth client SDK
  const sessionData = authClient.useSession();

  useEffect(() => {
    if (!sessionData.isPending) {
      if (sessionData.data?.user) {
        const u = sessionData.data.user as unknown as AuthUser;
        setUser(u);
        if ((u.mustResetPassword || !u.twoFactorEnabled) && !pathname.startsWith("/auth/onboarding")) {
          router.replace("/auth/onboarding");
        }
      } else {
        setUser(null);
        if (!pathname.startsWith("/auth/login")) {
          router.replace("/auth/login");
        }
      }
      setLoading(false);
    }
  }, [sessionData.data, sessionData.isPending, pathname, router]);

  const signOut = async () => {
    setLoading(true);
    try {
      await authClient.signOut();
      setUser(null);
      router.replace("/auth/login");
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, refetch: verifySession, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
