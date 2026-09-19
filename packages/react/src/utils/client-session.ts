"use client";

export const CLIENT_ID_STORAGE_KEY = "aomi_client_id";

const CONTROL_SESSION_PREFIX = "control:";

export function getOrCreateClientId(): string {
  try {
    const storedClientId = globalThis.localStorage?.getItem(
      CLIENT_ID_STORAGE_KEY,
    );
    if (storedClientId && storedClientId.trim().length > 0) {
      return storedClientId;
    }
  } catch {
    // localStorage not available
  }

  const clientId = globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}`;
  try {
    globalThis.localStorage?.setItem(CLIENT_ID_STORAGE_KEY, clientId);
  } catch {
    // localStorage not available
  }
  return clientId;
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
