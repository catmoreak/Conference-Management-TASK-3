import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

function getDefaultMainPanelUrl() {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:3000`;
    }
  }

  return "http://localhost:3000";
}

const DEFAULT_MAIN_PANEL_URL = getDefaultMainPanelUrl();

function normalizeAuthUrl(value) {
  return value.replace(/\/+$/, "");
}

export const mainPanelAuthUrl = normalizeAuthUrl(
  import.meta.env.VITE_MAIN_PANEL_URL ?? DEFAULT_MAIN_PANEL_URL,
);

export const authClient = createAuthClient({
  baseURL: mainPanelAuthUrl,
  plugins: [twoFactorClient()],
});

export function getDisplayRole(role) {
  if (!role) {
    return "Unassigned";
  }

  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getAuthErrorMessage(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || error.error || fallbackMessage;
}
