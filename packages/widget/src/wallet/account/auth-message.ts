import type { AomiBackendNonceResponse } from "./aomi-backend-client";

export type AuthMessageConfig = {
  domain: string;
  uri: string;
};

export function resolveAuthMessageConfig(input: {
  baseUrl?: string;
  authDomain?: string;
  authUri?: string;
}): AuthMessageConfig {
  const base = absoluteUrl(input.baseUrl);
  const fallbackOrigin =
    base?.origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const fallbackDomain =
    base?.host ?? (typeof window !== "undefined" ? window.location.host : "");
  return {
    domain: normalizeDomain(input.authDomain) ?? fallbackDomain,
    uri: normalizeUri(input.authUri) ?? fallbackOrigin,
  };
}

export function messageConfigFromNonce(
  nonce: AomiBackendNonceResponse,
  fallback: AuthMessageConfig,
): AuthMessageConfig {
  return completeAuthMessageConfig({
    domain: normalizeDomain(nonce.domain) ?? normalizeDomain(fallback.domain),
    uri: normalizeUri(nonce.uri) ?? normalizeUri(fallback.uri),
  });
}

function browserAuthMessageConfig(): AuthMessageConfig {
  if (typeof window === "undefined") {
    return { domain: "", uri: "" };
  }
  return {
    domain: window.location.host,
    uri: window.location.origin,
  };
}

function completeAuthMessageConfig(
  input: Partial<AuthMessageConfig>,
): AuthMessageConfig {
  const browserFallback = browserAuthMessageConfig();
  const uri =
    normalizeUri(input.uri) ??
    normalizeUri(browserFallback.uri) ??
    deriveUriFromDomain(input.domain) ??
    "http://localhost";
  const domain =
    normalizeDomain(input.domain) ??
    normalizeDomain(uri) ??
    normalizeDomain(browserFallback.domain) ??
    "localhost";
  return { domain, uri };
}

function absoluteUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeDomain(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const host = new URL(trimmed).host.trim();
    if (host) return host;
  } catch {
    // Fall through to authority parsing below.
  }
  return (
    trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim() || undefined
  );
}

function normalizeUri(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function deriveUriFromDomain(value: string | undefined): string | undefined {
  const domain = normalizeDomain(value);
  if (!domain) return undefined;
  return domain.includes("localhost") || domain.startsWith("127.")
    ? `http://${domain}`
    : `https://${domain}`;
}
