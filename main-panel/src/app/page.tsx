import { getSession } from "~/server/better-auth/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    redirect("/auth/login");
  }

  const role = (session.user as Record<string, unknown>).role as string | undefined;

  // Forced password reset / onboarding gate routing
  if ((session.user as Record<string, unknown>).mustResetPassword || !session.user.twoFactorEnabled) {
    redirect("/auth/onboarding");
  }

  // Post-login routing by role
  if (role === "admin") {
    redirect("/admin/accounts");
  } else if (role === "staff") {
    redirect("/audit-logs");
  } else {
    // pres_ops_staff or other roles
    redirect("/podium");
  }

  return null;
}
