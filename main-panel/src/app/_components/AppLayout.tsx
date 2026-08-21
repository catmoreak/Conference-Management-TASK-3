"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "./Navbar";
import { TopBar } from "./TopBar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Hide admin sidebar and header on these standalone routes
  const isStandalone =
    pathname === "/upload" ||
    pathname === "/checkin" ||
    pathname.startsWith("/auth/");

  if (isStandalone) {
    return <main className="w-screen h-screen overflow-auto">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]">
      <Navbar />
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
