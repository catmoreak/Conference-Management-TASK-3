/**
 * Standalone podium control-relay WebSocket server.
 *
 * Deliberately separate from the Next.js dev/prod server (no custom
 * server.js exists for this T3 app) -- run alongside it via `npm run
 * ws:dev`. Has no database dependency: authorization here is a per-message
 * role check against the already-live rbac.ts, not the newer AuthzStore
 * machinery in server/auth/authz/ (that module's own comments say it's
 * "not wired to anything yet" -- using it here would mean depending on an
 * unwired system instead of the one every other route actually enforces).
 *
 * Protocol:
 *   1. Client connects to ws://host:port?liveSessionId=<uuid>
 *   2. First message must be a PodiumAuthHandshake
 *      ({type:"auth", actorType:"service", serviceId, token}) -- the same
 *      shape podium's WebSocketClient already sends. Both podium (display)
 *      and the main-panel operator UI (control) send this identical shape;
 *      which role a connection gets is decided from the verified JWT's
 *      `purpose` claim (minted server-side by /api/ws/token), never from
 *      the client-asserted actorType/serviceId.
 *   3. Exactly one "control" connection is allowed per liveSessionId at a
 *      time (Control Lock) -- a second one is rejected until the first
 *      disconnects.
 *   4. PodiumCommand messages from the control connection are relayed
 *      verbatim to all "display" connections in the same liveSessionId;
 *      status/error messages from a display are relayed back to control.
 */

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";

// This script runs standalone via `tsx` (not through Next.js), so .env
// is not loaded automatically the way it is for `next dev`/`next start`.
// Without this, WS_JWT_SECRET falls back to the dev-only default here
// while the Next.js app signs tokens with the real secret from .env --
// causing every connection to fail with "invalid_signature".
dotenv.config({ path: path.resolve(import.meta.dirname, "..", ".env") });
import { validateWsConnect } from "../src/server/auth/ws-connect";
import { roleHasPermissions } from "../src/server/auth/rbac";

const PORT = Number(process.env.WS_PORT ?? 4001);
const AUTH_TIMEOUT_MS = 10_000;

// Per-connection message-rate cap. Nothing in the protocol needs anywhere
// near this many messages/sec (heartbeats are infrequent, commands are
// operator-paced) -- this is purely to stop a compromised or buggy display/
// control client from flooding a room once past the auth handshake.
const MESSAGE_RATE_LIMIT = 20;
const MESSAGE_RATE_WINDOW_MS = 1000;

// ── Transport: native TLS (wss://) if certs are configured, otherwise
// plain HTTP (ws://) -- the common alternative in production is a
// reverse proxy (nginx/ALB) terminating TLS in front of this process,
// which also works fine with the plain-HTTP mode below.
const tlsCertPath = process.env.WS_TLS_CERT_PATH;
const tlsKeyPath = process.env.WS_TLS_KEY_PATH;
const useTls = Boolean(tlsCertPath && tlsKeyPath);

const httpServer = useTls
  ? https.createServer({
      cert: fs.readFileSync(tlsCertPath!),
      key: fs.readFileSync(tlsKeyPath!),
    })
  : http.createServer();

const COMMAND_TYPES = new Set([
  "load_presentation",
  "play",
  "goto_slide",
  "next_slide",
  "prev_slide",
  "exit_slideshow",
]);

type Purpose = "control" | "display";

interface Room {
  control: WebSocket | null;
  displays: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(liveSessionId: string): Room {
  let room = rooms.get(liveSessionId);
  if (!room) {
    room = { control: null, displays: new Set() };
    rooms.set(liveSessionId, room);
  }
  return room;
}

function cleanupRoomIfEmpty(liveSessionId: string): void {
  const room = rooms.get(liveSessionId);
  if (room && !room.control && room.displays.size === 0) {
    rooms.delete(liveSessionId);
  }
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: "error", code, message });
}

// Plain HTTP requests (not WS upgrades) hitting this same port/server are
// treated as a health check -- lets a load balancer or uptime monitor
// point at this process without a separate port.
httpServer.on("request", (req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const liveSessionId = url.searchParams.get("liveSessionId");

  if (!liveSessionId) {
    sendError(ws, "missing_session_id", "liveSessionId query param is required");
    ws.close();
    return;
  }

  let authenticated = false;
  let purpose: Purpose | null = null;
  let role = "";

  const authTimer = setTimeout(() => {
    if (!authenticated) {
      sendError(ws, "auth_timeout", "No auth handshake received in time");
      ws.close();
    }
  }, AUTH_TIMEOUT_MS);

  let msgWindowStart = Date.now();
  let msgCount = 0;

  ws.on("message", (raw: Buffer) => {
    const now = Date.now();
    if (now - msgWindowStart >= MESSAGE_RATE_WINDOW_MS) {
      msgWindowStart = now;
      msgCount = 0;
    }
    msgCount++;
    if (msgCount > MESSAGE_RATE_LIMIT) {
      sendError(ws, "rate_limited", "Too many messages, closing connection");
      ws.close(1008, "rate_limited");
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
    } catch {
      return;
    }

    // ── Auth handshake (first message) ──────────────────────────────
    if (!authenticated) {
      if (msg.type !== "auth" || typeof msg.token !== "string") {
        sendError(ws, "invalid_handshake", "First message must be an auth handshake");
        ws.close();
        return;
      }

      void validateWsConnect({ token: msg.token, liveSessionId }).then((result) => {
        if (!result.valid) {
          sendError(ws, "unauthorized", result.reason);
          ws.close();
          return;
        }

        clearTimeout(authTimer);
        authenticated = true;
        purpose = result.payload.purpose;
        role = result.payload.role;

        const room = getOrCreateRoom(liveSessionId);

        if (purpose === "control") {
          if (room.control?.readyState === WebSocket.OPEN) {
            sendError(ws, "control_locked", "Another operator already controls this session");
            ws.close();
            return;
          }
          room.control = ws;
        } else {
          room.displays.add(ws);
        }

        console.log(
          `[podium-ws] auth ok: session=${liveSessionId} purpose=${purpose} role=${role} ` +
            `displaysInRoom=${room.displays.size} hasControl=${Boolean(room.control)}`,
        );

        send(ws, {
          type: "status",
          sessionId: liveSessionId,
          status: "connected",
          timestamp: Date.now(),
        });
      });
      return;
    }

    // ── Post-auth messages ───────────────────────────────────────────
    if (msg.type === "heartbeat") {
      return;
    }

    const room = rooms.get(liveSessionId);
    if (!room) return;

    if (purpose === "control") {
      if (!COMMAND_TYPES.has(msg.type as string)) {
        return;
      }
      if (!roleHasPermissions(role, "live-control:operate")) {
        sendError(ws, "forbidden", "Role lacks live-control:operate permission");
        return;
      }
      console.log(
        `[podium-ws] relaying ${msg.type as string} from control to ${room.displays.size} display(s) in session=${liveSessionId}`,
      );
      for (const display of room.displays) {
        send(display, msg);
      }
    } else if (purpose === "display") {
      // Relay status/error updates from the display back to the operator.
      console.log(`[podium-ws] display->control relay: ${JSON.stringify(msg)}`);
      if (room.control) {
        send(room.control, msg);
      }
    }
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    if (!authenticated) return;
    const room = rooms.get(liveSessionId);
    if (!room) return;
    if (purpose === "control" && room.control === ws) {
      room.control = null;
    } else if (purpose === "display") {
      room.displays.delete(ws);
    }
    cleanupRoomIfEmpty(liveSessionId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[podium-ws] listening on ${useTls ? "wss" : "ws"}://0.0.0.0:${PORT} (health check: /health)`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────
// Without this, a process-manager restart/redeploy just severs every open
// socket mid-frame instead of telling clients why -- podium's WebSocketClient
// already has reconnect-with-backoff, but a clean close code lets it log
// something more useful than a raw connection drop.
function shutdown(signal: string) {
  console.log(`[podium-ws] received ${signal}, shutting down...`);
  for (const client of wss.clients) {
    client.close(1001, "server_shutting_down");
  }
  wss.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
  // Force-exit if connections don't close cleanly within 5s.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
