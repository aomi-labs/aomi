"use client";

import { createScopedStorage, type ScopedStorage } from "@aomi-labs/client";

export const CLIENT_ID_STORAGE_KEY = "aomi_client_id";

const CONTROL_SESSION_PREFIX = "control:";

export function getOrCreateClientId(
  storage: ScopedStorage = createScopedStorage({ backendUrl: "" }),
): string {
  const stored = storage.migrate("clientId", CLIENT_ID_STORAGE_KEY);
  if (stored?.trim()) return stored;
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storage.set("clientId", id);
  return id;
}

export function getControlSessionId(
  clientId: string | null | undefined,
  fallbackSessionId: string,
): string {
  const trimmedClientId = clientId?.trim();
  return trimmedClientId
    ? `${CONTROL_SESSION_PREFIX}${trimmedClientId}`
    : fallbackSessionId;
}

// UUID polyfill for Safari and older browsers
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Fallback for browsers without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
