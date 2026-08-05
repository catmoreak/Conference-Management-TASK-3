import type { PodiumAuthHandshake, PodiumHeartbeat, PodiumCommand, PodiumStatus, PodiumError } from "../schema/podium-ws-schema";
import type { PresentationController } from "../presentation/PresentationController";
import { validatePodiumCommand } from "./commandValidator";

export class WebSocketClient {
  private readonly url: string;
  private readonly serviceId: string;
  private readonly token: string;
  private readonly presentationController: PresentationController | null;
  private socket: WebSocket | null = null;
  private authHandshakeSent = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private isDisconnecting = false;

  /**
   * Creates a lightweight WebSocket client shell for the Podium Electron app.
   * The constructor stores the connection parameters so the class can evolve
   * into a richer client without changing the public shape.
   */
  constructor(url: string, serviceId: string, token: string, presentationController?: PresentationController) {
    this.url = url;
    this.serviceId = serviceId;
    this.token = token;
    this.presentationController = presentationController ?? null;

    if (this.presentationController) {
      this.presentationController.onStateChange((state) => {
        this.sendStatus({
          type: "status",
          sessionId: "",
          status: "ready",
          message: typeof state === "string" ? state : "state_changed",
          timestamp: Date.now(),
        });
      });

      this.presentationController.onError((error) => {
        this.sendError({
          type: "error",
          code: "presentation_error",
          message: typeof error === "string" ? error : "presentation_error",
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
      console.info(
        `[Podium WebSocket] Disconnected: ${this.serviceId} (code=${event.code}, reason=${event.reason || "none"})`,
      );

      if (!this.isDisconnecting) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener("error", (event: Event) => {
      console.error(`[Podium WebSocket] Connection error: ${this.serviceId}`, event);
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

    try {
      const parsed = JSON.parse(rawData) as unknown;
      const command = validatePodiumCommand(parsed);

      if (!command) {
        return;
      }

      await this.routeCommand(command);
    } catch {
      console.warn("[Podium WebSocket] Unable to parse incoming message.");
    }
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
