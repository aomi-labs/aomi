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
