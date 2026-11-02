import type { Config } from "./config";

/**
 * Who may read a response cross-origin:
 * - `any`: everyone, without credentials (public documents, discovery);
 * - `echo`: any https (or local) site, without credentials (the open widget:
 *   only an explicit widget session or OAuth token authorizes a call);
 * - `allowlist`: CORS_ALLOWED_HOST_PATTERNS, with credentials;
 * - `task`: the allowlist, plus TASK_CORS_PUBLIC_ORIGINS without credentials.
 */
export type CorsPolicy = {
  origin: "any" | "echo" | "allowlist" | "task";
  methods: readonly string[];
  headers?: readonly string[];
  expose?: readonly string[];
  maxAge?: number;
};

/**
 * The open widget: any https site (or a local dev host) may embed it without
 * registering. Nothing allows credentials, so only an explicit widget session
 * or OAuth token can authorize a cross-origin call.
 */
export const openWidget = (methods: readonly string[]): CorsPolicy => ({
  origin: "echo",
  methods,
  headers: [
    "Authorization", "Content-Type", "Aomi-App-Key", "Last-Event-ID", "DPoP", "Idempotency-Key",
    "Payment-Signature", "X-Aomi-Inference-Funding", "X-Aomi-Run-Budget-Microusd", "X-Aomi-CSRF",
    "X-Request-Id", "X-Session-Id", "X-Thread-Id",
  ],
  expose: [
    "DPoP-Nonce", "WWW-Authenticate", "Payment-Required", "Payment-Receipt", "Payment-Response",
    "X-Payment-Response", "Retry-After", "X-Request-Id",
  ],
  maxAge: 600,
});

/** Credential-free documents anyone may read (catalogs, JWKS, discovery). */
export const publicRead = (methods: readonly string[] = ["GET", "HEAD"]): CorsPolicy => ({ origin: "any", methods });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The request's Origin when it is a usable https (or local http) origin. */
export function observedOrigin(request: Request): string | null {
  const raw = request.headers.get("origin");
  if (!raw || raw === "null") return null;
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    return null;
  }
  if (origin.origin !== raw) return null;
  if (origin.protocol === "https:") return origin.origin;
  if (origin.protocol === "http:" && LOCAL_HOSTS.has(origin.hostname)) return origin.origin;
  return null;
}

export function isAllowedCorsOrigin(origin: string | null, cfg: Config): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.host.toLowerCase();
  return cfg.cors.hostPatterns.some((pattern) =>
    pattern.startsWith("*.")
      ? host === pattern.slice(2) || host.endsWith(pattern.slice(1))
      : host === pattern,
  );
}

/** The Allow-Origin value and whether credentials go with it; null allows nobody. */
function grant(policy: CorsPolicy, request: Request, cfg: Config): { origin: string; credentials: boolean } | null {
  const origin = request.headers.get("origin");
  switch (policy.origin) {
    case "any":
      return { origin: "*", credentials: false };
    case "echo":
      // With no usable origin there is nothing to echo, but the caller must
      // still be able to read why it was refused; nothing here carries credentials.
      return { origin: observedOrigin(request) ?? "*", credentials: false };
    case "task":
      if (origin && cfg.cors.taskPublicOrigins.includes(origin)) return { origin, credentials: false };
    // falls through: everyone else gets the allowlist.
    case "allowlist":
      return origin && isAllowedCorsOrigin(origin, cfg) ? { origin, credentials: true } : null;
  }
}

function appendVary(headers: Headers, value: string): void {
  const vary = new Set(
    (headers.get("vary") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  vary.add(value);
  headers.set("vary", [...vary].join(", "));
}

function corsHeaders(headers: Headers, policy: CorsPolicy, request: Request, cfg: Config): void {
  if (policy.origin !== "any") appendVary(headers, "Origin");
  headers.delete("access-control-allow-credentials");
  const allowed = grant(policy, request, cfg);
  if (!allowed) return;
  headers.set("access-control-allow-origin", allowed.origin);
  if (allowed.credentials) headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", [...policy.methods, "OPTIONS"].join(", "));
  if (policy.headers?.length) headers.set("access-control-allow-headers", policy.headers.join(", "));
  if (policy.expose?.length) headers.set("access-control-expose-headers", policy.expose.join(", "));
}

/** The response with this policy's CORS headers (upstream responses are immutable, so a copy). */
export function withCors(policy: CorsPolicy, request: Request, response: Response, cfg: Config): Response {
  const headers = new Headers(response.headers);
  corsHeaders(headers, policy, request, cfg);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function preflight(policy: CorsPolicy, request: Request, cfg: Config): Response {
  const headers = new Headers();
  corsHeaders(headers, policy, request, cfg);
  headers.set("access-control-max-age", String(policy.maxAge ?? 600));
  return new Response(null, { status: 204, headers });
}

/** Set on everything the edge answers. */
export function withSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("strict-transport-security", "max-age=31536000");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
