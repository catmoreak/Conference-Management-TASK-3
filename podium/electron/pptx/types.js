// @ts-check
/**
 * The command/status/error contract with the WebSocket layer. This is the
 * ONLY place these shapes are declared -- mirrors the pattern in
 * server/src/auth/permissions.ts (PERMISSIONS as the single source of truth).
 */

/**
 * @typedef {Object} VideoTrimInfo
 * @property {number} slideNumber
 * @property {string} mediaId
 * @property {number} startSeconds
 * @property {number} endSeconds
 */

/**
 * @typedef {Object} LoadPresentationCommand
 * @property {"load_presentation"} type
 * @property {string} sessionId
 * @property {string} fileUrl
 * @property {string} presentationId
 * @property {VideoTrimInfo[]} videoTrims
 */

/** @typedef {{ type: "goto_slide", sessionId: string, slideNumber: number }} GotoSlideCommand */
/** @typedef {{ type: "next_slide", sessionId: string }} NextSlideCommand */
/** @typedef {{ type: "prev_slide", sessionId: string }} PrevSlideCommand */
/** @typedef {{ type: "play", sessionId: string }} PlayCommand */
/** @typedef {{ type: "exit_slideshow", sessionId: string }} ExitSlideshowCommand */

/**
 * @typedef {LoadPresentationCommand | GotoSlideCommand | NextSlideCommand | PrevSlideCommand | PlayCommand | ExitSlideshowCommand} PodiumCommand
 */

/** @typedef {"offline" | "online" | "loading" | "ready" | "playing" | "error"} PodiumState */

/**
 * @typedef {Object} PodiumStatus
 * @property {"status"} type
 * @property {string | null} sessionId
 * @property {PodiumState} state
 * @property {number | null} currentSlide
 * @property {number | null} totalSlides
 * @property {string} timestamp
 */

/** @typedef {"com_connection_failed" | "file_not_found" | "com_call_failed" | "powerpoint_crashed" | "unknown"} PodiumErrorCode */

/**
 * @typedef {Object} PodiumError
 * @property {"error"} type
 * @property {string | null} sessionId
 * @property {PodiumErrorCode} code
 * @property {string} message
 * @property {string} timestamp
 */

export const PODIUM_ERROR_CODES = /** @type {const} */ ([
  "com_connection_failed",
  "file_not_found",
  "com_call_failed",
  "powerpoint_crashed",
  "unknown",
]);

export {};
