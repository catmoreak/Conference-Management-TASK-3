export type PodiumCommand =
  | {
      /**
       * Command used to load a presentation file into the presenter runtime.
       */
      readonly type: "load_presentation";
      /**
       * The presentation session that the command targets.
       */
      readonly sessionId: string;
      /**
       * Identifier of the presentation to load.
       */
      readonly presentationId: string;
      /**
       * URL of the presentation file to load.
       */
      readonly fileUrl: string;
    }
  | {
      /**
       * Command used to display a plain-text interstitial "cover" slide
       * (e.g. the event name) instead of a real presentation file --
       * fills the screen during the gap between two presentations.
       */
      readonly type: "show_cover";
      /**
       * The presentation session that the command targets.
       */
      readonly sessionId: string;
      /**
       * Identifier of the cover item being shown (a Submission row with
       * itemType "cover").
       */
      readonly presentationId: string;
      /**
       * The free text to render on the cover screen.
       */
      readonly text: string;
    }
  | {
      /**
       * Command used to start playback.
       */
      readonly type: "play";
      /**
       * The presentation session that the command targets.
       */
      readonly sessionId: string;
    }
  | {
      /**
       * Command used to jump to a specific slide in the active presentation.
       */
      readonly type: "goto_slide";
      /**
       * The presentation session that the command targets.
       */
      readonly sessionId: string;
      /**
       * The slide number to open.
       */
      readonly slideNumber: number;
    }
  | {
      /**
       * Command used to advance to the next slide.
       */
      readonly type: "next_slide";
      /**
       * The presentation session that the command targets.
       */
      readonly sessionId: string;
    }
  | {
      /**
       * Command used to move to the previous slide.
       */
      readonly type: "prev_slide";
      /**
       * The presentation session that the command targets.
       */
      readonly sessionId: string;
    }
  | {
      /**
       * Command used to end the active slideshow.
       */
      readonly type: "exit_slideshow";
      /**
       * The presentation session that the command targets.
       */
      readonly sessionId: string;
    };

export interface PodiumState {
  /**
   * Discriminator for a state update emitted by the backend.
   */
  readonly type: "state";
  /**
   * The presentation session this state belongs to.
   */
  readonly sessionId: string;
  /**
   * The current playback state of the presentation.
   */
  readonly state: "idle" | "playing" | "paused" | "ended";
  /**
   * The currently active slide index, when known.
   */
  readonly slideIndex?: number;
  /**
   * Monotonic timestamp for correlation and debugging.
   */
  readonly timestamp: number;
}

export interface PodiumStatus {
  /**
   * Discriminator for a lightweight status update.
   */
  readonly type: "status";
  /**
   * The presentation session this status pertains to.
   */
  readonly sessionId: string;
  /**
   * The connection or runtime status that is currently true. "display_connected"
   * and "display_disconnected" are relay-generated (sent to the control
   * connection only, when a podium display joins/leaves the room) rather
   * than reported by podium itself.
   */
  readonly status: "connecting" | "ready" | "connected" | "disconnected" | "error" | "display_connected" | "display_disconnected" | "playing" | "offline";
  /**
   * Optional human-readable explanation of the current status.
   */
  readonly message?: string;
  /**
   * Number of podium displays currently in the room. Present on
   * "connected"/"display_connected"/"display_disconnected" status messages
   * sent to a control connection.
   */
  readonly displayCount?: number;
  /**
   * Monotonic timestamp for correlation and debugging.
   */
  readonly timestamp: number;
}

export interface PodiumError {
  /**
   * Discriminator for an error payload sent over the wire.
   */
  readonly type: "error";
  /**
   * Stable machine-readable error code.
   */
  readonly code: string;
  /**
   * Human-readable explanation of the failure.
   */
  readonly message: string;
  /**
   * The affected session, when the error is scoped to a presentation.
   */
  readonly sessionId?: string;
  /**
   * Optional structured details for debugging or UI rendering.
   */
  readonly details?: Record<string, unknown>;
}

export interface PodiumHeartbeat {
  /**
   * Discriminator for a liveness heartbeat message.
   */
  readonly type: "heartbeat";
  /**
   * ISO 8601 timestamp emitted with each heartbeat for liveness checks.
   */
  readonly timestamp: string;
}

export interface PodiumAuthHandshake {
  /**
   * Discriminator for the initial authentication handshake.
   */
  readonly type: "auth";
  /**
   * The actor kind for the handshake payload.
   */
  readonly actorType: "service";
  /**
   * The service identifier that is authenticating.
   */
  readonly serviceId: string;
  /**
   * Authentication token supplied by the client.
   */
  readonly token: string;
}

/**
 * The full union of shared WebSocket message shapes. This is the single
 * contract imported by both the Electron client and the backend.
 */
export type PodiumMessage =
  | PodiumCommand
  | PodiumState
  | PodiumStatus
  | PodiumError
  | PodiumHeartbeat
  | PodiumAuthHandshake;
