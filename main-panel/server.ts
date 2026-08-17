import http from "node:http";

import next from "next";
import { WebSocketServer, WebSocket } from "ws";

import { validateWsConnect } from "~/server/auth/ws-connect";
import { roleHasPermissions } from "~/server/auth/rbac";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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

function notifyControlOfDisplayCount(room: Room, liveSessionId: string): void {
  if (!room.control) return;
  send(room.control, {
    type: "status",
    sessionId: liveSessionId,
    status: room.displays.size > 0 ? "display_connected" : "display_disconnected",
    displayCount: room.displays.size,
    timestamp: Date.now(),
  });
}

const COMMAND_TYPES = new Set([
  "load_presentation",
  "play",
  "goto_slide",
  "next_slide",
  "prev_slide",
  "exit_slideshow",
  "show_cover",
]);

const AUTH_TIMEOUT_MS = 10_000;
const MESSAGE_RATE_LIMIT = 20;
const MESSAGE_RATE_WINDOW_MS = 1000;

const wss = new WebSocketServer({ noServer: true });

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

        send(ws, {
          type: "status",
          sessionId: liveSessionId,
          status: "connected",
          displayCount: room.displays.size,
          timestamp: Date.now(),
        });

        if (purpose === "display") {
          notifyControlOfDisplayCount(room, liveSessionId);
        }
      });
      return;
    }

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
      if (room.displays.size === 0) {
        sendError(ws, "no_display", "No podium display is connected to this session");
        return;
      }
      for (const display of room.displays) {
        send(display, msg);
      }
    } else if (purpose === "display") {
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
      notifyControlOfDisplayCount(room, liveSessionId);
    }
    cleanupRoomIfEmpty(liveSessionId);
  });
});

const httpServer = http.createServer(async (req, res) => {
  const requestPath = (req.url ?? "").split("?")[0] ?? "";
  if (requestPath === "/health" || requestPath === "/ws/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }

  await handle(req, res);
});

httpServer.on("upgrade", (req, socket, head) => {
  const requestPath = (req.url ?? "").split("?")[0] ?? "";
  if (requestPath !== "/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

async function start(): Promise<void> {
  await app.prepare();
  httpServer.listen(port, hostname, () => {
    console.log(`[main-panel] ready on http://${hostname}:${port} (ws: /ws)`);
  });
}

void start();
