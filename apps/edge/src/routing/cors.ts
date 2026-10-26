import type { EdgeEnv } from "../env";
import type { CorsProfile } from "./routes";

const API_ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const HEALTH_ALLOWED_METHODS = "GET, OPTIONS";
const TASK_ALLOWED_METHODS = "POST, OPTIONS";
const API_ALLOWED_HEADERS =
  "Authorization,Content-Type,DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Range,X-Session-Id,X-Thread-Id,Aomi-App-Key,X-Aomi-Handover-Session";
const HEALTH_ALLOWED_HEADERS =
  "Authorization,Content-Type,X-Session-Id,X-Thread-Id,Aomi-App-Key";
const TASK_ALLOWED_HEADERS = "Content-Type,Payment-Signature";
const JWKS_ALLOWED_METHODS = "GET, OPTIONS";
const JWKS_ALLOWED_HEADERS = "Content-Type";
const HSTS_VALUE = "max-age=31536000";

type CorsConfig = {
  allowMethods: string;
  allowHeaders: string;
  exposeHeaders?: string;
};

function parseHostPatterns(env: EdgeEnv): string[] {
  return (env.CORS_ALLOWED_HOST_PATTERNS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === pattern;
}

export function isAllowedCorsOrigin(
  origin: string | null,
  env: EdgeEnv,
): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  const host = parsed.host.toLowerCase();
  return parseHostPatterns(env).some((pattern) =>
    hostMatchesPattern(host, pattern),
  );
}

function getCorsConfig(corsProfile: CorsProfile): CorsConfig {
  switch (corsProfile) {
    case "payment":
      return {
        allowMethods: "GET, HEAD, POST, OPTIONS",
        allowHeaders:
          "Authorization, Content-Type, Idempotency-Key, Payment-Signature, X-Request-Id",
        exposeHeaders: "Payment-Required, Payment-Response, X-Request-Id",
      };
    case "api":
      return { allowMethods: API_ALLOWED_METHODS, allowHeaders: API_ALLOWED_HEADERS };
    case "task-discovery":
      // A discovery read may answer with the body-bound 402, so the header
      // that carries it is readable by any origin too.
      return {
        allowMethods: "GET, HEAD, OPTIONS",
        allowHeaders: "Content-Type",
        exposeHeaders: "Payment-Required",
      };
    case "jwks":
      return { allowMethods: JWKS_ALLOWED_METHODS, allowHeaders: JWKS_ALLOWED_HEADERS };
    case "task":
      return {
        allowMethods: TASK_ALLOWED_METHODS,
        allowHeaders: TASK_ALLOWED_HEADERS,
        exposeHeaders: "Payment-Required, Payment-Response",
      };
    case "health":
      return { allowMethods: HEALTH_ALLOWED_METHODS, allowHeaders: HEALTH_ALLOWED_HEADERS };
  }
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }
  const values = current
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.includes(value)) {
    values.push(value);
    headers.set("Vary", values.join(", "));
  }
}

export function applySecurityHeaders(headers: Headers): void {
  headers.set("Strict-Transport-Security", HSTS_VALUE);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
}

export function applyCorsHeaders(
  headers: Headers,
  origin: string | null,
  env: EdgeEnv,
  corsProfile: CorsProfile,
): void {
  const corsConfig = getCorsConfig(corsProfile);

  if (corsProfile === "task-discovery" || corsProfile === "jwks") {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", corsConfig.allowMethods);
    headers.set("Access-Control-Allow-Headers", corsConfig.allowHeaders);
    if (corsConfig.exposeHeaders) {
      headers.set("Access-Control-Expose-Headers", corsConfig.exposeHeaders);
    }
    return;
  }

  appendVary(headers, "Origin");

  // Public Task buyers may inspect a body-bound 402 from a browser. These
  // exact origins never receive credentialed access to the other API routes.
  const publicTaskOrigin =
    corsProfile === "task" &&
    origin !== null &&
    (env.TASK_CORS_PUBLIC_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .includes(origin);
  if (!publicTaskOrigin && !isAllowedCorsOrigin(origin, env)) return;
  if (origin === null) return;

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", corsConfig.allowMethods);
  headers.set("Access-Control-Allow-Headers", corsConfig.allowHeaders);
  if (publicTaskOrigin) {
    headers.delete("Access-Control-Allow-Credentials");
  } else {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  if (corsConfig.exposeHeaders) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposeHeaders);
  }
}

export function createPreflightResponse(
  origin: string | null,
  env: EdgeEnv,
  corsProfile: CorsProfile,
): Response {
  const headers = new Headers({
    "Content-Length": "0",
    "Content-Type": "text/plain; charset=utf-8",
  });
  applySecurityHeaders(headers);
  applyCorsHeaders(headers, origin, env, corsProfile);
  headers.set("Access-Control-Max-Age", "1728000");
  return new Response(null, { status: 204, headers });
}

export function decorateResponse(
  response: Response,
  origin: string | null,
  env: EdgeEnv,
  corsProfile: CorsProfile,
): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  applyCorsHeaders(headers, origin, env, corsProfile);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function notFound(): Response {
  const headers = new Headers();
  applySecurityHeaders(headers);
  return new Response("Not found", { status: 404, headers });
}
