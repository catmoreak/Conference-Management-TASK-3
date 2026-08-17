import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js middleware that prevents the framework from handling WebSocket upgrade requests.
 * The /ws path is handled by the custom server (server.ts) via HTTP upgrade.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let the custom server handle WebSocket paths
  if (pathname === "/ws" || pathname.startsWith("/ws/")) {
    // Return early response to prevent Next.js from processing
    // The actual upgrade will be handled by server.ts
    return new NextResponse(null, { status: 426, statusText: "Upgrade Required" });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/ws", "/ws/:path*"],
};
