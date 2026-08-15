import type { PodiumAuthHandshake, PodiumHeartbeat, PodiumCommand, PodiumStatus, PodiumError } from "../schema/podium-ws-schema";
import type { PresentationController } from "../presentation/PresentationController";
import { validatePodiumCommand } from "./commandValidator";

/**
 * Lifecycle hooks so callers (e.g. the display-connect UI) can reflect the
 * *real* handshake outcome instead of assuming success as soon as connect()
 * is called -- connect() only opens the socket, it doesn't guarantee the
 * server accepted the auth handshake.
 */
export interface WebSocketClientHooks {
  /** Fired once the server confirms the auth handshake ({type:"status", status:"connected"}). */
  onAuthSuccess?: () => void;
  /** Fired when the server rejects the handshake or any other error frame arrives before that. */
  onAuthError?: (code: string, message: string) => void;
  /** Fired when the socket closes, at any point in its lifecycle. */
  onClose?: (event: CloseEvent) => void;
  /** Fired on a transport-level WebSocket error. */
  onSocketError?: (event: Event) => void;
}

export class WebSocketClient {
  private readonly url: string;
  private readonly serviceId: string;
  private readonly token: string;
  private readonly presentationController: PresentationController | null;
  private readonly hooks: WebSocketClientHooks;
  private socket: WebSocket | null = null;
  private authHandshakeSent = false;
  private authConfirmed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private isDisconnecting = false;

  /**
   * Creates a lightweight WebSocket client shell for the Podium Electron app.
   * The constructor stores the connection parameters so the class can evolve
   * into a richer client without changing the public shape.
   */
  constructor(
    url: string,
    serviceId: string,
    token: string,
    presentationController?: PresentationController,
    hooks?: WebSocketClientHooks,
  ) {
    this.url = url;
    this.serviceId = serviceId;
    this.token = token;
    this.presentationController = presentationController ?? null;
    this.hooks = hooks ?? {};

    if (this.presentationController) {
      this.presentationController.onStateChange((state) => {
        // `state` is the raw {type, sessionId, status, timestamp} object main.js
        // sends over 'podium-status' IPC (see IpcPresentationController.onStateChange),
        // not a bare string -- so `typeof state === "string"` was always false here,
        // meaning control previously got a hardcoded status:"ready"/message:"state_changed"
        // for every transition (load/play/exit/offline all looked identical), which made
        // it impossible for the operator UI to tell whether Play/Next/Prev actually landed.
        const statusValue =
          this.isRecord(state) && typeof state.status === "string" ? (state.status as PodiumStatus["status"]) : "ready";
        const sessionId = this.isRecord(state) && typeof state.sessionId === "string" ? state.sessionId : "";
        const message = this.isRecord(state) && typeof state.message === "string" ? state.message : undefined;
        this.sendStatus({
          type: "status",
          sessionId,
          status: statusValue,
          ...(message ? { message } : {}),
          timestamp: Date.now(),
        });
      });

      this.presentationController.onError((error) => {
        // Same bug as onStateChange above: `error` is the raw {type, sessionId,
        // code, message, timestamp} object main.js sends over 'podium-error' IPC,
        // not a bare string -- so this always sent the generic fallback message
        // "presentation_error" instead of the real failure reason, and always
        // duplicated whatever real error routeCommand()'s own catch already sent
        // (that one carries the real message; this one only ever said
        // "presentation_error" with no sessionId).
        const code = this.isRecord(error) && typeof error.code === "string" ? error.code : "presentation_error";
        const message = this.isRecord(error) && typeof error.message === "string" ? error.message : "presentation_error";
        const sessionId = this.isRecord(error) && typeof error.sessionId === "string" ? error.sessionId : undefined;
        this.sendError({
          type: "error",
          code,
          message,
          ...(sessionId ? { sessionId } : {}),
        });
      });
    }
  }

  /**
   * Opens a connection if one is not already active or pending.
   * This prevents duplicate socket instances from being created by accident.
   */
  public connect(): WebSocket | null {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      return this.socket;
    }

    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in the current runtime.");
    }

    this.isDisconnecting = false;
    this.authHandshakeSent = false;
    this.authConfirmed = false;
    this.socket = new WebSocket(this.url);
    this.attachEventHandlers();

    return this.socket;
  }

  /**
   * Closes the active socket when present and clears the stored instance.
   * This keeps the client state tidy and prevents future operations from
   * reusing a stale connection object.
   */
  public disconnect(): void {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    this.isDisconnecting = true;
    this.authHandshakeSent = false;
    this.authConfirmed = false;
    this.stopHeartbeat();
    this.stopReconnectTimer();

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  /**
   * Attaches the lifecycle handlers for the current socket instance.
   * These are intentionally simple and isolated so the class remains easy to
   * extend for future phases without changing the public API.
   */
  private attachEventHandlers(): void {
    if (!this.socket) {
      return;
    }

    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.isDisconnecting = false;
      console.info(`[Podium WebSocket] Connected: ${this.serviceId}`);
      this.stopReconnectTimer();
      this.sendAuthHandshake();
    });

    this.socket.addEventListener("close", (event: CloseEvent) => {
      this.stopHeartbeat();
      this.authConfirmed = false;
      console.info(
        `[Podium WebSocket] Disconnected: ${this.serviceId} (code=${event.code}, reason=${event.reason || "none"})`,
      );
      this.hooks.onClose?.(event);

      if (!this.isDisconnecting) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener("error", (event: Event) => {
      console.error(`[Podium WebSocket] Connection error: ${this.serviceId}`, event);
      this.hooks.onSocketError?.(event);
    });

    this.socket.addEventListener("message", (event: MessageEvent) => {
      this.handleIncomingMessage(event.data);
    });
  }

  /**
   * Sends the authentication handshake once after the socket is open.
   * This keeps the handshake logic isolated and ensures the client does not
   * emit duplicate auth messages for the same connection.
   */
  private sendAuthHandshake(): void {
    if (this.authHandshakeSent || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const handshake: PodiumAuthHandshake = {
      type: "auth",
      actorType: "service",
      serviceId: this.serviceId,
      token: this.token,
    };

    this.socket.send(JSON.stringify(handshake));
    this.authHandshakeSent = true;
    this.startHeartbeat();
  }

  private async handleIncomingMessage(rawData: unknown): Promise<void> {
    if (typeof rawData !== "string") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      console.warn("[Podium WebSocket] Unable to parse incoming message.");
      return;
    }

    // The server's first post-handshake reply is either a {type:"status",
    // status:"connected"} confirmation or a {type:"error", code, message}
    // rejection (e.g. invalid_signature, control_locked, forbidden) --
    // neither of those is a PodiumCommand, so this must be checked before
    // validatePodiumCommand() would otherwise silently discard it.
    if (this.isRecord(parsed) && !this.authConfirmed) {
      if (parsed.type === "status" && parsed.status === "connected") {
        this.authConfirmed = true;
        this.hooks.onAuthSuccess?.();
      } else if (parsed.type === "error") {
        const code = typeof parsed.code === "string" ? parsed.code : "unknown";
        const message = typeof parsed.message === "string" ? parsed.message : "Connection rejected";
        this.hooks.onAuthError?.(code, message);
      }
    }

    const command = validatePodiumCommand(parsed);

    if (!command) {
      return;
    }

    // Deliberately a separate try/catch from the JSON.parse above -- a
    // command that fails during execution (IPC bridge missing, PowerPoint
    // COM failure, etc.) is NOT a parse error, and previously fell into the
    // same catch block, which only logged "Unable to parse incoming
    // message" and swallowed the real failure entirely. The operator
    // console never saw it, so a broken load_presentation/play looked
    // identical to success with no error reported anywhere.
    try {
      await this.routeCommand(command);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Podium WebSocket] Command '${command.type}' failed:`, err);
      this.sendError({
        type: "error",
        sessionId: command.sessionId,
        code: "presentation_error",
        message,
      });
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  public sendStatus(status: PodiumStatus): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(status));
  }

  public sendError(error: PodiumError): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(error));
  }

  private async routeCommand(command: PodiumCommand): Promise<void> {
    if (!this.presentationController) {
      return;
    }

    switch (command.type) {
      case "load_presentation":
        await this.presentationController.loadPresentation(command.fileUrl, command.presentationId);
        break;
      case "show_cover":
        await this.presentationController.showCover(command.text, command.presentationId);
        break;
      case "play":
        await this.presentationController.play();
        break;
      case "goto_slide":
        await this.presentationController.gotoSlide(command.slideNumber);
        break;
      case "next_slide":
        await this.presentationController.nextSlide();
        break;
      case "prev_slide":
        await this.presentationController.prevSlide();
        break;
      case "exit_slideshow":
        await this.presentationController.exitSlideshow();
        break;
      default:
        break;
    }
  }

  /**
   * Starts a periodic heartbeat timer after the auth handshake has been sent.
   * The timer is guarded so the client never creates duplicate intervals for
   * the same connection.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }

      const heartbeat: PodiumHeartbeat = {
        type: "heartbeat",
        timestamp: new Date().toISOString(),
      };

      this.socket.send(JSON.stringify(heartbeat));
    }, 10_000);
  }

  /**
   * Stops any active heartbeat timer and clears the stored reference.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedules a reconnect attempt using exponential backoff capped at 30s.
   * The reconnect timer is guarded so only one pending retry exists.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    const delayMs = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  /**
   * Clears any pending reconnect timer.
   */
  private stopReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
