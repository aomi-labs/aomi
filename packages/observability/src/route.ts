import * as Sentry from "@sentry/node";

import type {
  AppService,
  AppUpstream,
  FailureDecision,
  FailureResult,
  LocalDiagnostic,
  LocalDiagnosticValue,
} from "./failure";
import {
  normalizeRequestPath,
  scrubSentryEvent,
  scrubSentryLog,
} from "./privacy";

export type AppSentryOptions = { service: AppService };

type EventContext = {
  service: AppService;
  routeFamily: string;
  operation: string;
  method?: string;
  status: number;
  upstream?: AppUpstream;
  upstreamStatus?: number;
  handled: boolean;
  durationMs?: number;
  smokeTest?: boolean;
};

const SERVICES = new Set<AppService>(["portal", "build"]);
const UPSTREAMS = new Set<AppUpstream>([
  "rust",
  "github",
  "vercel",
  "supabase",
]);
const METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);
const SAFE_OPERATION = /^[a-z][a-z0-9._-]{0,79}$/;
const SAFE_ROUTE_FAMILY = /^\/?[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,158}$/;
const SAFE_LOCAL_DIAGNOSTIC_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
const SAFE_SHA = /^[a-f0-9]{7,64}$/i;
const DISABLED_INTEGRATIONS = new Set([
  "Anthropic_AI",
  "CaptureConsole",
  "Console",
  "ConsoleLogs",
  "Google_GenAI",
  "LangChain",
  "LangGraph",
  "LocalVariables",
  "LocalVariablesAsync",
  "OnUncaughtException",
  "OnUnhandledRejection",
  "OpenAI",
  "RequestData",
  "VercelAI",
]);
const INITIALIZED_SERVICES = new Set<AppService>();

/** Layer 3: route one classified decision to its approved destinations. */
export function routeFailure(
  decision: FailureDecision,
  service: AppService,
): FailureResult {
  try {
    return routeDecision(decision, service);
  } catch (error) {
    const fallback: FailureDecision = {
      action: "issue",
      reason: "local_exception",
      error,
      context: {
        routeFamily: "/observability",
        operation: "observability.routing_failure",
      },
      handled: true,
      responseStatus: 500,
      responseError: "internal_error",
    };
    return routeDecision(fallback, service);
  }
}

function routeDecision(
  decision: FailureDecision,
  service: AppService,
): FailureResult {
  const routedDecision = normalizeDecision(decision);
  const response = Response.json(
    {
      error: routedDecision.responseError,
      // Emitted only when the identifier set them, so every other route's
      // body shape is unchanged.
      ...(routedDecision.responseCode
        ? { code: routedDecision.responseCode }
        : {}),
      ...(routedDecision.responseRetryable !== undefined
        ? { retryable: routedDecision.responseRetryable }
        : {}),
      ...(routedDecision.responseDeployError
        ? { deployError: routedDecision.responseDeployError }
        : {}),
    },
    { status: routedDecision.responseStatus },
  );
  const attributes =
    eventAttributes({
      service,
      ...routedDecision.context,
      status: routedDecision.responseStatus,
      ...(routedDecision.upstream ? { upstream: routedDecision.upstream } : {}),
      ...(routedDecision.upstreamStatus !== undefined
        ? { upstreamStatus: routedDecision.upstreamStatus }
        : {}),
      handled: routedDecision.handled,
    }) ?? invalidContextAttributes(service, routedDecision);
  if (routedDecision.action === "ignore") {
    writeLocalDiagnostic(routedDecision.localDiagnostic, attributes);
    return { ...routedDecision, response };
  }

  if (routedDecision.action === "log") {
    writeLocalError("app.upstream_failure", attributes);
    try {
      Sentry.withIsolationScope((scope) => {
        scope.setLevel("error");
        scope.setTags(attributes);
        Sentry.logger.error("app.upstream_failure", attributes, { scope });
      });
    } catch {
      // Telemetry delivery must never replace the owned response.
    }
    return { ...routedDecision, response };
  }

  const error =
    routedDecision.error instanceof Error
      ? routedDecision.error
      : new Error("Non-Error app server exception");
  writeLocalError("app.exception", attributes, error);
  try {
    Sentry.withIsolationScope((scope) => {
      scope.setLevel("error");
      scope.setTags(attributes);
      Sentry.captureException(error);
    });
  } catch {
    // Telemetry delivery must never replace the owned response.
  }
  return { ...routedDecision, response };
}

function normalizeDecision(decision: FailureDecision): FailureDecision {
  return {
    ...decision,
    responseStatus: isResponseStatus(decision.responseStatus)
      ? decision.responseStatus
      : 500,
    responseError:
      typeof decision.responseError === "string" && decision.responseError
        ? decision.responseError
        : "internal_error",
  };
}

function invalidContextAttributes(
  service: AppService,
  decision: FailureDecision,
): Record<string, string | number | boolean> {
  return {
    service,
    route_family: "/observability",
    operation: "observability.invalid_context",
    "http.status_code": decision.responseStatus,
    handled: decision.handled,
    runtime: "nodejs",
  };
}

export function initAppSentry(options: AppSentryOptions): boolean {
  if (!options || !SERVICES.has(options.service)) return false;
  const configuration = sentryConfiguration(options.service);
  if (!configuration) return false;

  try {
    Sentry.init({
      dsn: configuration.dsn,
      environment: configuration.environment,
      release: configuration.release,
      enableLogs: true,
      enableMetrics: false,
      tracesSampleRate: 0,
      sampleRate: 1,
      sendDefaultPii: false,
      attachStacktrace: true,
      includeLocalVariables: false,
      beforeBreadcrumb: () => null,
      beforeSend: scrubSentryEvent,
      beforeSendLog: scrubSentryLog,
      integrations: (integrations) => [
        ...integrations.filter(
          (integration) => !DISABLED_INTEGRATIONS.has(integration.name),
        ),
        Sentry.requestDataIntegration({
          include: {
            cookies: false,
            data: false,
            headers: false,
            ip: false,
            query_string: false,
            url: false,
          },
        }),
      ],
      initialScope: {
        tags: { service: options.service, runtime: "nodejs" },
      },
    });
    INITIALIZED_SERVICES.add(options.service);
    return true;
  } catch {
    INITIALIZED_SERVICES.delete(options.service);
    return false;
  }
}

export function getAppSentryRelease(service: AppService): string | undefined {
  if (!SERVICES.has(service)) return undefined;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  return sha && SAFE_SHA.test(sha) ? `${service}@${sha}` : undefined;
}

export function isAppSentryEnabled(): boolean {
  return sentryConfiguration("portal") !== undefined;
}

function sentryConfiguration(
  service: AppService,
):
  | { dsn: string; environment: "staging" | "production"; release: string }
  | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  if (process.env.SENTRY_ENABLED !== "1") return undefined;

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return undefined;
  const environment = process.env.SENTRY_ENVIRONMENT;
  if (environment !== "staging" && environment !== "production") {
    return undefined;
  }
  const release = getAppSentryRelease(service);
  return release ? { dsn, environment, release } : undefined;
}

function eventAttributes(
  context: EventContext,
): Record<string, string | number | boolean> | undefined {
  if (!isValidContext(context)) return undefined;
  const routeFamily = normalizeRequestPath(context.routeFamily);
  if (routeFamily !== "/" && !SAFE_ROUTE_FAMILY.test(routeFamily)) {
    return undefined;
  }

  const attributes: Record<string, string | number | boolean> = {
    service: context.service,
    route_family: routeFamily,
    operation: context.operation,
    "http.status_code": context.status,
    handled: context.handled,
    runtime: "nodejs",
  };
  const environment = appEnvironment();
  if (environment) attributes.environment = environment;
  const release = getAppSentryRelease(context.service);
  if (release) attributes.release = release;
  if (context.method) attributes.method = context.method.toUpperCase();
  if (context.upstream) attributes.upstream = context.upstream;
  if (context.upstreamStatus !== undefined) {
    attributes["upstream.status_code"] = context.upstreamStatus;
  }
  if (context.durationMs !== undefined) {
    attributes.duration_ms = Math.round(context.durationMs);
  }
  if (context.smokeTest !== undefined) {
    attributes.smoke_test = context.smokeTest;
  }
  return attributes;
}

function isValidContext(context: EventContext): boolean {
  if (!SERVICES.has(context.service)) return false;
  if (typeof context.routeFamily !== "string") return false;
  if (
    typeof context.operation !== "string" ||
    !SAFE_OPERATION.test(context.operation)
  ) {
    return false;
  }
  if (!isHttpStatus(context.status)) return false;
  if (context.method !== undefined) {
    if (typeof context.method !== "string") return false;
    if (!METHODS.has(context.method.toUpperCase())) return false;
  }
  if (context.upstream && !UPSTREAMS.has(context.upstream)) return false;
  if (context.upstreamStatus !== undefined && !context.upstream) return false;
  if (
    context.upstreamStatus !== undefined &&
    !isHttpStatus(context.upstreamStatus)
  ) {
    return false;
  }
  if (
    context.durationMs !== undefined &&
    (!Number.isFinite(context.durationMs) ||
      context.durationMs < 0 ||
      context.durationMs > 3_600_000)
  ) {
    return false;
  }
  return (
    context.smokeTest === undefined || typeof context.smokeTest === "boolean"
  );
}

function appEnvironment(): "staging" | "production" | undefined {
  const environment = process.env.SENTRY_ENVIRONMENT;
  return environment === "staging" || environment === "production"
    ? environment
    : undefined;
}

function isHttpStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 100 && value <= 599;
}

function isResponseStatus(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 200 &&
    value <= 599 &&
    value !== 204 &&
    value !== 205 &&
    value !== 304
  );
}

function writeLocalError(
  message: "app.exception" | "app.upstream_failure",
  attributes: Record<string, string | number | boolean>,
  error?: Error,
): void {
  const development = process.env.NODE_ENV === "development";
  const service = attributes.service;
  const productionFallback =
    process.env.NODE_ENV === "production" &&
    typeof service === "string" &&
    SERVICES.has(service as AppService) &&
    !INITIALIZED_SERVICES.has(service as AppService);
  if (!development && !productionFallback) return;
  try {
    if (development && error) console.error(message, attributes, error);
    else console.error(message, attributes);
  } catch {
    // Local diagnostics are best-effort and must not change request behavior.
  }
}

function writeLocalDiagnostic(
  diagnostic: LocalDiagnostic | undefined,
  context: Record<string, string | number | boolean>,
): void {
  if (process.env.NODE_ENV !== "development" || !diagnostic) return;
  const attributes = localDiagnosticAttributes(diagnostic);
  if (!attributes) return;
  try {
    console.warn("app.expected_failure", { ...attributes, ...context });
  } catch {
    // Local diagnostics are best-effort and must not change request behavior.
  }
}

function localDiagnosticAttributes(
  diagnostic: LocalDiagnostic,
): Record<string, LocalDiagnosticValue> | undefined {
  if (!SAFE_OPERATION.test(diagnostic.kind)) return undefined;
  const entries = Object.entries(diagnostic.attributes ?? {});
  if (entries.length > 20) return undefined;

  const attributes: Record<string, LocalDiagnosticValue> = {};
  for (const [key, value] of entries) {
    if (!SAFE_LOCAL_DIAGNOSTIC_KEY.test(key)) return undefined;
    if (typeof value === "string" && value.length > 160) return undefined;
    if (typeof value === "number" && !Number.isFinite(value)) return undefined;
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return undefined;
    }
    attributes[key] = value;
  }
  attributes.diagnostic = diagnostic.kind;
  return attributes;
}
