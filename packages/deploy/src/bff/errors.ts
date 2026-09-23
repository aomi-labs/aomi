// =============================================================================
// Launch source identification.
//
// This module owns only facts that require deploy-domain types. Telemetry
// classification and delivery belong to @aomi-labs/bff-observability.
// =============================================================================

import { BackendError, DeployError } from "../errors";
import type { DeployErrorDetail } from "../types";

export type LaunchFailureSource = {
  origin: "expected" | "local" | "upstream_request" | "upstream_response";
  error: unknown;
  upstream?: "github" | "rust";
  upstreamStatus?: number;
  credential?: "service";
  response: {
    status: number;
    error: string;
    /** Stable identifier the browser can branch on. */
    code?: string;
    /** False when retrying cannot help — an operator has to act. */
    retryable?: boolean;
    /** The Manager's structured `deploy_error`, when its envelope carried one. */
    deployError?: DeployErrorDetail;
  };
};

/** Layer 1: identify a deploy-domain error without choosing a telemetry route. */
export function identifyLaunchError(error: unknown): LaunchFailureSource {
  const requiredSecretsError = asRequiredSecretsCheckError(error);
  if (requiredSecretsError) {
    // Carry the reason and its retryability through to the browser. Flattening
    // every one of these to "try again" told a builder whose BFF is missing
    // its GITHUB_TOKEN to retry a request that can never succeed until an
    // operator fixes the deployment.
    const retryable = requiredSecretsError.retryable ?? true;
    const common = {
      error: requiredSecretsError.cause ?? error,
      response: {
        status: 503,
        error:
          requiredSecretsError.message ??
          "Unable to verify required secrets. Try again.",
        code: requiredSecretsError.reason
          ? `required_secrets_${requiredSecretsError.reason}`
          : REQUIRED_SECRETS_CHECK_UNAVAILABLE_CODE,
        retryable,
      },
    } as const;
    if (
      requiredSecretsError.upstream &&
      requiredSecretsError.upstreamStatus !== undefined
    ) {
      return {
        ...common,
        origin: "upstream_response",
        upstream: requiredSecretsError.upstream,
        upstreamStatus: requiredSecretsError.upstreamStatus,
        credential: "service",
      };
    }
    if (requiredSecretsError.upstream) {
      return {
        ...common,
        origin: "upstream_request",
        upstream: requiredSecretsError.upstream,
      };
    }
    return { ...common, origin: "local" };
  }

  const backendError = asBackendError(error);
  if (backendError) {
    const common = {
      error: backendError.cause ?? error,
      upstream: "rust" as const,
    };
    if (backendError.status === 0) {
      return {
        ...common,
        origin: "upstream_request",
        response: { status: 502, error: backendError.message },
      };
    }
    return {
      ...common,
      origin: "upstream_response",
      upstreamStatus: backendError.status,
      credential: "service",
      response: backendResponse(backendError),
    };
  }

  if (isDeployError(error, "INVALID_REQUEST")) {
    return {
      origin: "expected",
      error,
      response: {
        status: 400,
        error: activationErrorMessage(error) ?? error.message,
      },
    };
  }

  return {
    origin: "local",
    error,
    response: {
      status: 502,
      error: error instanceof Error ? error.message : String(error),
    },
  };
}

/** Default response adapter for the deploy package's framework-neutral routes. */
export function launchErrorResponse(error: unknown): Response {
  const failure = identifyLaunchError(error);
  return Response.json(
    {
      error: failure.response.error,
      ...(failure.response.code ? { code: failure.response.code } : {}),
      ...(failure.response.retryable !== undefined
        ? { retryable: failure.response.retryable }
        : {}),
      ...(failure.response.deployError
        ? { deployError: failure.response.deployError }
        : {}),
    },
    { status: failure.response.status },
  );
}

type BackendErrorLike = {
  status: number;
  message: string;
  body?: string;
  cause?: unknown;
  reason?: unknown;
};

/** Kept structural: this module must not import the error class it inspects. */
type RequiredSecretsCheckErrorLike = {
  cause?: unknown;
  message?: string;
  reason?: string;
  retryable?: boolean;
  upstream?: "github" | "rust";
  upstreamStatus?: number;
};

const REQUIRED_SECRETS_CHECK_UNAVAILABLE_CODE =
  "required_secrets_check_unavailable";

function asRequiredSecretsCheckError(
  error: unknown,
): RequiredSecretsCheckErrorLike | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as RequiredSecretsCheckErrorLike & { code?: unknown };
  return candidate.code === "REQUIRED_SECRETS_CHECK_UNAVAILABLE"
    ? candidate
    : null;
}

function asBackendError(error: unknown): BackendErrorLike | null {
  if (error instanceof BackendError) return error;
  if (!error || typeof error !== "object") return null;
  const candidate = error as Partial<BackendErrorLike> & { code?: unknown };
  return (candidate.code === "BACKEND" || candidate.code === "ACTIVATION") &&
    typeof candidate.status === "number" &&
    typeof candidate.message === "string"
    ? (candidate as BackendErrorLike)
    : null;
}

function isDeployError(
  error: unknown,
  code: DeployError["code"],
): error is DeployError {
  return (
    (error instanceof DeployError ||
      (typeof error === "object" && error !== null && "code" in error)) &&
    (error as { code?: unknown }).code === code
  );
}

function backendResponse(
  error: BackendErrorLike,
): LaunchFailureSource["response"] {
  if (error.status >= 400 && error.status <= 599) {
    const envelope = backendErrorEnvelope(error.body);
    return {
      status: error.status,
      error: envelope.error ?? activationErrorMessage(error) ?? error.message,
      ...(envelope.code ? { code: envelope.code } : {}),
      ...(envelope.deployError
        ? {
            retryable: envelope.deployError.retryable,
            deployError: envelope.deployError,
          }
        : {}),
    };
  }
  return { status: 502, error: "upstream_unavailable" };
}

/**
 * The Manager's error envelope: `{ error, error_code?, deploy_error? }`. Only
 * `error` used to survive this hop, which flattened a structured "the GitHub
 * App lacks `actions: write`" into "returned HTTP 403" by the time it reached
 * a browser.
 */
function backendErrorEnvelope(body?: string): {
  error: string | null;
  code: string | null;
  deployError: DeployErrorDetail | null;
} {
  const none = { error: null, code: null, deployError: null };
  if (!body) return none;
  try {
    const json = JSON.parse(body) as {
      error?: unknown;
      error_code?: unknown;
      deploy_error?: unknown;
    };
    const raw =
      json.deploy_error && typeof json.deploy_error === "object"
        ? (json.deploy_error as Record<string, unknown>)
        : null;
    const deployError =
      raw && typeof raw.code === "string" && typeof raw.message === "string"
        ? {
            code: raw.code,
            message: raw.message,
            hint: typeof raw.hint === "string" ? raw.hint : null,
            // Absent means "unknown", and an unknown failure keeps its Retry.
            retryable: raw.retryable !== false,
            details:
              raw.details && typeof raw.details === "object"
                ? (raw.details as Record<string, unknown>)
                : {},
          }
        : null;
    return {
      error: typeof json.error === "string" ? json.error : null,
      code:
        typeof json.error_code === "string"
          ? json.error_code
          : (deployError?.code ?? null),
      deployError,
    };
  } catch {
    return none;
  }
}

function activationErrorMessage(error: unknown): string | null {
  const reason =
    error && typeof error === "object" && "reason" in error
      ? error.reason
      : undefined;
  if (!Array.isArray(reason)) {
    return null;
  }
  const first = reason.find(
    (reason): reason is { error: string } =>
      typeof reason === "object" &&
      reason !== null &&
      "error" in reason &&
      typeof reason.error === "string",
  );
  return first?.error ?? null;
}
