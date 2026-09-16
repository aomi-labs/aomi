"use client";

import "client-only";

const SETTINGS_SESSION_KEY = "aomi_settings_session_id";
const SECRET_STORAGE_KEY = "aomi_secret_key";

function generateSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `settings-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getSettingsSessionId(): string {
  if (typeof window === "undefined") {
    return "settings-server";
  }

  const existing = window.localStorage.getItem(SETTINGS_SESSION_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const next = generateSessionId();
  window.localStorage.setItem(SETTINGS_SESSION_KEY, next);
  return next;
}

export function getBackendUrl(): string {
  // Always same-origin: the browser calls `/api/*` on the portal, and the
  // catch-all proxy (apps/portal/src/app/api/[...slug]/route.ts) injects the
  // AccountBearer from the httpOnly session cookie and forwards to the backend.
  // An empty base makes the client build same-origin relative URLs. The proxy
  // ships with the portal, so this is always available; the upstream backend is
  // configured server-side in the proxy, not here. (httpOnly session cookies are
  // same-origin only, so direct cross-origin calls could never carry auth.)
  return "";
}

function joinApiPath(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl === "/" ? "" : baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}` || normalizedPath;
}

export function getSettingsSecret(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(SECRET_STORAGE_KEY);
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function sessionScopedFetch<T>(
  path: string,
  options?: RequestInit & { secret?: string | null },
): Promise<T> {
  const { secret, ...requestInit } = options ?? {};
  const url = joinApiPath(getBackendUrl(), path);
  const headers = new Headers(requestInit.headers ?? {});
  headers.set("X-Session-Id", getSettingsSessionId());
  headers.set("X-Thread-Id", getSettingsSessionId());
  const resolvedSecret =
    secret === undefined ? getSettingsSecret() : secret?.trim() || null;
  if (resolvedSecret) {
    headers.set("Aomi-App-Key", resolvedSecret);
  }
  if (!headers.has("Content-Type") && requestInit.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...requestInit,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export const settingsApiFetch = sessionScopedFetch;

export async function accountScopedFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  // Same-origin `/api/account/*` through the portal proxy, which injects the
  // AccountBearer from the BetterAuth session. The browser carries no bearer
  // itself.
  const response = await fetch(`${getBackendUrl()}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {}),
    },
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
