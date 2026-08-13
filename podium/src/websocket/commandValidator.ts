import type { PodiumCommand } from "../schema/podium-ws-schema";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function warnInvalidPayload(type: string, missingFields: string[]): void {
  console.warn(`[Podium WebSocket] Missing or invalid fields for ${type}: ${missingFields.join(", ")}`);
}

/**
 * Validates an incoming WebSocket payload against the agreed Podium command contract.
 * The function is defensive: unknown input, unsupported command types, and malformed
 * payloads are treated as invalid and return null instead of throwing.
 */
export function validatePodiumCommand(input: unknown): PodiumCommand | null {
  if (!isRecord(input)) {
    console.warn("[Podium WebSocket] Invalid command payload: expected an object.");
    return null;
  }

  const candidate = input;
  const commandType = candidate.type;

  if (typeof commandType !== "string") {
    console.warn("[Podium WebSocket] Invalid command payload: missing command type.");
    return null;
  }

  switch (commandType) {
    case "load_presentation": {
      const missingFields: string[] = [];

      if (!isNonEmptyString(candidate.sessionId)) {
        missingFields.push("sessionId");
      }
      if (!isNonEmptyString(candidate.presentationId)) {
        missingFields.push("presentationId");
      }
      if (!isNonEmptyString(candidate.fileUrl)) {
        missingFields.push("fileUrl");
      }

      if (missingFields.length > 0) {
        warnInvalidPayload(commandType, missingFields);
        return null;
      }

      return {
        type: "load_presentation",
        sessionId: candidate.sessionId as string,
        presentationId: candidate.presentationId as string,
        fileUrl: candidate.fileUrl as string,
      };
    }

    case "show_cover": {
      const missingFields: string[] = [];

      if (!isNonEmptyString(candidate.sessionId)) {
        missingFields.push("sessionId");
      }
      if (!isNonEmptyString(candidate.presentationId)) {
        missingFields.push("presentationId");
      }
      if (!isNonEmptyString(candidate.text)) {
        missingFields.push("text");
      }

      if (missingFields.length > 0) {
        warnInvalidPayload(commandType, missingFields);
        return null;
      }

      return {
        type: "show_cover",
        sessionId: candidate.sessionId as string,
        presentationId: candidate.presentationId as string,
        text: candidate.text as string,
      };
    }

    case "play": {
      const missingFields: string[] = [];

      if (!isNonEmptyString(candidate.sessionId)) {
        missingFields.push("sessionId");
      }

      if (missingFields.length > 0) {
        warnInvalidPayload(commandType, missingFields);
        return null;
      }

      return {
        type: "play",
        sessionId: candidate.sessionId as string,
      };
    }

    case "goto_slide": {
      const missingFields: string[] = [];

      if (!isNonEmptyString(candidate.sessionId)) {
        missingFields.push("sessionId");
      }
      if (!isFiniteNumber(candidate.slideNumber)) {
        missingFields.push("slideNumber");
      }

      if (missingFields.length > 0) {
        warnInvalidPayload(commandType, missingFields);
        return null;
      }

      return {
        type: "goto_slide",
        sessionId: candidate.sessionId as string,
        slideNumber: candidate.slideNumber as number,
      };
    }

    case "next_slide": {
      const missingFields: string[] = [];

      if (!isNonEmptyString(candidate.sessionId)) {
        missingFields.push("sessionId");
      }

      if (missingFields.length > 0) {
        warnInvalidPayload(commandType, missingFields);
        return null;
      }

      return {
        type: "next_slide",
        sessionId: candidate.sessionId as string,
      };
    }

    case "prev_slide": {
      const missingFields: string[] = [];

      if (!isNonEmptyString(candidate.sessionId)) {
        missingFields.push("sessionId");
      }

      if (missingFields.length > 0) {
        warnInvalidPayload(commandType, missingFields);
        return null;
      }

      return {
        type: "prev_slide",
        sessionId: candidate.sessionId as string,
      };
    }

    case "exit_slideshow": {
      const missingFields: string[] = [];

      if (!isNonEmptyString(candidate.sessionId)) {
        missingFields.push("sessionId");
      }

      if (missingFields.length > 0) {
        warnInvalidPayload(commandType, missingFields);
        return null;
      }

      return {
        type: "exit_slideshow",
        sessionId: candidate.sessionId as string,
      };
    }

    default:
      console.info(`[Podium WebSocket] Ignoring unknown command type: ${commandType}`);
      return null;
  }
}
