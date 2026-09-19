import type { Event, Log } from "@sentry/nextjs";

const SAFE_EVENT_TAGS = new Set([
  "duration_ms",
  "environment",
  "handled",
  "http.status_code",
  "method",
  "operation",
  "release",
  "route_family",
  "runtime",
  "sentry.environment",
  "sentry.release",
  "service",
  "smoke_test",
  "upstream",
  "upstream.status_code",
]);

const SAFE_LOG_MESSAGES = new Set(["bff.smoke_test", "bff.upstream_failure"]);

const STATIC_ROUTE_SEGMENTS = new Set([
  "account",
  "account-bearer",
  "activate",
  "aomi",
  "api",
  "app",
  "apps",
  "auth",
  "bff",
  "bots",
  "build",
  "callback",
  "cancel",
  "chat",
  "chats",
  "cli",
  "create",
  "deactivate",
  "decision",
  "deployment",
  "deployments",
  "detail",
  "dev-session",
  "device-auth",
  "download",
  "e2e",
  "exchange",
  "execute",
  "feed",
  "file",
  "github",
  "grant",
  "health",
  "history",
  "identities",
  "integrations",
  "instrumentation",
  "internal",
  "launch",
  "link",
  "link-grant",
  "link-intent",
  "login",
  "logs",
  "mcp",
  "model-keys",
  "models",
  "nonce",
  "oauth",
  "observability",
  "operate",
  "preflight",
  "promote",
  "provider",
  "projects",
  "proxy",
  "records",
  "redeploy",
  "required-secrets",
  "run",
  "runs",
  "sdk-status",
  "sdk-upgrade",
  "sdk-upgrade-status",
  "secrets",
  "sentry-smoke",
  "session",
  "settings",
  "sign-out",
  "signout",
  "siwe",
  "siws",
  "solana",
  "sources",
  "status",
  "supervise",
  "thread",
  "threads",
  "token",
  "tools",
  "transactions",
  "usage",
  "v1",
  "verify",
  "wallet",
  "wallets",
  "widget",
]);

const SAFE_VALUE = /^[a-zA-Z0-9][a-zA-Z0-9._:@/\[\]-]*$/;
const JWT_SHAPED_VALUE =
  /^[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}$/;
const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;
const SAFE_ID =
  /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

export function normalizeRequestPath(value: string): string {
  if (typeof value !== "string") return "/:param";
  const path = extractPathname(value);
  const segments = path.split("/").filter(Boolean).map(normalizeRouteSegment);

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function scrubSentryEvent<T extends Event>(event: T): T | null {
  if (event.type !== undefined) return null;

  const exception = scrubException(event.exception);
  const sanitized: Event = {
    event_id: safeId(event.event_id),
    timestamp: finiteNumber(event.timestamp),
    level: event.level === "fatal" ? "fatal" : "error",
    platform: safeScalar(event.platform),
    release: safeScalar(event.release),
    environment: safeEnvironment(event.environment),
    transaction: event.transaction
      ? normalizeRequestPath(event.transaction)
      : undefined,
    exception,
    tags: scrubAttributes(event.tags),
    debug_meta: scrubDebugMeta(event.debug_meta),
  };

  return withoutUndefined(sanitized) as T;
}

export function scrubSentryLog(log: Log): Log | null {
  const message = String(log.message);
  if (!SAFE_LOG_MESSAGES.has(message)) return null;

  return {
    level: "error",
    message,
    attributes: scrubAttributes(log.attributes),
    severityNumber: finiteNumber(log.severityNumber),
  };
}

function extractPathname(value: string): string {
  const withoutFragment = value.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";

  try {
    return new URL(value).pathname;
  } catch {
    return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  }
}

function normalizeRouteSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment).toLowerCase();
  } catch {
    return ":param";
  }

  if (decoded === ":param" || decoded === ":catchall") return decoded;
  if (/^\[\[\.\.\.[a-z0-9_-]+\]\]$/.test(decoded)) return ":catchall";
  if (/^\[\.\.\.[a-z0-9_-]+\]$/.test(decoded)) return ":catchall";
  if (/^\[[a-z0-9_-]+\]$/.test(decoded)) return ":param";
  return STATIC_ROUTE_SEGMENTS.has(decoded) ? decoded : ":param";
}

function scrubException(exception: Event["exception"]): Event["exception"] {
  if (!exception?.values) return undefined;

  return {
    values: exception.values.map((value) => ({
      type:
        value.type && SAFE_ERROR_TYPE.test(value.type) ? value.type : "Error",
      value: "BFF exception",
      mechanism: value.mechanism
        ? {
            type: safeScalar(value.mechanism.type) ?? "generic",
            handled: value.mechanism.handled,
            synthetic: value.mechanism.synthetic,
          }
        : undefined,
      stacktrace: value.stacktrace?.frames
        ? {
            frames: value.stacktrace.frames.map((frame) => ({
              filename: scrubStackPath(frame.filename),
              platform: safeScalar(frame.platform),
              lineno: finiteNumber(frame.lineno),
              colno: finiteNumber(frame.colno),
              abs_path: scrubStackPath(frame.abs_path),
              in_app: frame.in_app,
              debug_id: safeId(frame.debug_id),
            })),
            frames_omitted: value.stacktrace.frames_omitted,
          }
        : undefined,
    })),
  };
}

function scrubStackPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutFragment = value.split("#", 1)[0] ?? "";
  const path = withoutFragment.split("?", 1)[0] ?? "";
  if (!isKnownStackPath(path)) return undefined;
  return path.slice(0, 512) || undefined;
}

function isKnownStackPath(value: string): boolean {
  if (value.startsWith("node:")) return true;
  if (value.startsWith("app:///_next/server/")) return true;
  if (
    value.startsWith("webpack-internal:///") ||
    value.startsWith("webpack:///")
  ) {
    return true;
  }
  return [
    "/.next/server/",
    "/apps/portal/",
    "/apps/build/",
    "/packages/account/",
    "/packages/bff-observability/",
    "/packages/deploy/",
  ].some((fragment) => value.includes(fragment));
}

function scrubDebugMeta(
  debugMeta: Event["debug_meta"],
): Event["debug_meta"] | undefined {
  const images = debugMeta?.images
    ?.map((image) => {
      if (image.type !== "sourcemap") return undefined;
      const codeFile = scrubStackPath(image.code_file);
      const debugId = safeId(image.debug_id);
      if (!codeFile || !debugId) return undefined;
      return {
        type: "sourcemap" as const,
        code_file: codeFile,
        debug_id: debugId,
      };
    })
    .filter((image): image is NonNullable<typeof image> => image !== undefined);
  return images && images.length > 0 ? { images } : undefined;
}

function scrubAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!attributes) return undefined;

  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!SAFE_EVENT_TAGS.has(key)) continue;
    if (typeof value === "boolean") sanitized[key] = value;
    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    }
    if (
      typeof value === "string" &&
      (key === "environment" || key === "sentry.environment")
    ) {
      const environment = safeEnvironment(value);
      if (environment) sanitized[key] = environment;
    } else if (typeof value === "string" && key === "route_family") {
      sanitized[key] = normalizeRequestPath(value);
    } else if (typeof value === "string" && isSafeScalar(value)) {
      sanitized[key] = value.slice(0, 200);
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function safeEnvironment(value: string | undefined): string | undefined {
  return value === "staging" || value === "production" ? value : undefined;
}

function safeScalar(value: string | undefined): string | undefined {
  if (!value || !isSafeScalar(value)) return undefined;
  return value.slice(0, 200);
}

function isSafeScalar(value: string): boolean {
  return SAFE_VALUE.test(value) && !JWT_SHAPED_VALUE.test(value);
}

function safeId(value: string | undefined): string | undefined {
  return value && SAFE_ID.test(value) ? value : undefined;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
