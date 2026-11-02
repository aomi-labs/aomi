"use client";

import {
  Aomi,
  createScopedStorage,
  type ScopedStorage,
  type AomiHttpMethod,
} from "@aomi-labs/client";
const SETTINGS_SESSION_KEY = "aomi_settings_session_id";

export function getSettingsSessionId(
  storage: ScopedStorage = createScopedStorage({ backendUrl: "" }),
): string {
  if (typeof window === "undefined") return "settings-server";
  const existing = storage.migrate("settingsSession", SETTINGS_SESSION_KEY);
  if (existing?.trim()) return existing;
  const next =
    globalThis.crypto?.randomUUID?.() ??
    `settings-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storage.set("settingsSession", next);
  return next;
}
/** @deprecated Same-origin host transport is explicit; removed in the next major. */
export function getBackendUrl(): string {
  return "";
}
/** @deprecated Credentials are held by useApiKey; pass secret explicitly. */
export function getSettingsSecret(): string | null {
  return null;
}

let deprecated: Aomi | undefined;
/** The deprecated same-origin fetch helpers below share one `Aomi`. */
function same(): Aomi {
  return (deprecated ??= new Aomi({
    baseUrl: "",
    fetch: (url, options) =>
      fetch(url, { ...options, credentials: "same-origin", cache: "no-store" }),
  }));
}
/** @deprecated Use `Aomi` from @aomi-labs/client; removed in the next major. */
export async function sessionScopedFetch<T>(
  path: string,
  options?: RequestInit & { secret?: string | null },
): Promise<T> {
  const { secret, ...init } = options ?? {};
  const headers = new Headers(init.headers);
  if (secret?.trim()) headers.set("Aomi-App-Key", secret.trim());
  // eslint-disable-next-line no-restricted-syntax -- deprecated path passthrough
  return same().raw.request<T>((init.method ?? "GET") as AomiHttpMethod, path, {
    headers,
    sessionId: getSettingsSessionId(),
    signal: init.signal ?? undefined,
    body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
  });
}
export const settingsApiFetch = sessionScopedFetch;
/** @deprecated Use `Aomi` from @aomi-labs/client; removed in the next major. */
export async function accountScopedFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  // eslint-disable-next-line no-restricted-syntax -- deprecated path passthrough
  return same().raw.request<T>(
    (options?.method ?? "GET") as AomiHttpMethod,
    path,
    {
      headers: options?.headers,
      signal: options?.signal ?? undefined,
      body:
        typeof options?.body === "string"
          ? JSON.parse(options.body)
          : undefined,
    },
  );
}
