import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export function getSavedMainPanelUrl() {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("podium_server_url");
    if (saved) return saved.replace(/\/+$/, "");
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:3000`;
    }
  }
  return (import.meta.env.VITE_MAIN_PANEL_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function setSavedMainPanelUrl(url) {
  if (typeof window !== "undefined") {
    localStorage.setItem("podium_server_url", url.replace(/\/+$/, ""));
    window.location.reload();
  }
}

export const mainPanelAuthUrl = getSavedMainPanelUrl();

export const authClient = createAuthClient({
  baseURL: mainPanelAuthUrl,
  fetchOptions: {
    credentials: "include",
  },
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
