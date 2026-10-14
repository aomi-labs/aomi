import type {
  FailureDecision,
  FailureReason,
  IdentifiedFailure,
  PublicFailure,
} from "./failure";

export function classifyFailure(failure: IdentifiedFailure): FailureDecision {
  if (failure.origin === "expected") {
    return decision(failure, "ignore", "expected", {
      status: failure.responseHint?.status ?? 400,
      error: failure.responseHint?.error ?? "invalid_request",
    });
  }

  if (failure.origin === "local") {
    return decision(
      failure,
      "issue",
      "local_exception",
      failure.responseHint ?? { status: 500, error: "internal_error" },
    );
  }

  if (failure.origin === "upstream_request") {
    return decision(
      failure,
      "issue",
      "upstream_request_failed",
      failure.responseHint ?? {
        status: 502,
        error: "upstream_unavailable",
      },
    );
  }

  const status = failure.upstreamStatus;
  if (!isHttpStatus(status) || status < 400) {
    return decision(
      failure,
      "issue",
      "invalid_upstream_status",
      failure.responseHint ?? {
        status: 502,
        error: "upstream_unavailable",
      },
    );
  }
  if (failure.credential === "service" && (status === 401 || status === 403)) {
    return decision(
      failure,
      "issue",
      "service_credential_rejected",
      failure.responseHint ?? { status: 500, error: "internal_error" },
    );
  }
  if (status >= 500) {
    return decision(
      failure,
      "log",
      "upstream_response_failed",
      failure.responseHint ?? {
        status,
        error: "upstream_unavailable",
      },
    );
  }
  return decision(
    failure,
    "ignore",
    "expected",
    failure.responseHint ?? { status, error: "upstream_rejected" },
  );
}

function decision(
  failure: IdentifiedFailure,
  action: FailureDecision["action"],
  reason: FailureReason,
  response: PublicFailure,
): FailureDecision {
  return {
    action,
    reason,
    error: failure.error,
    context: failure.context,
    handled: failure.handled,
    responseStatus: response.status,
    responseError: response.error,
    ...(response.code ? { responseCode: response.code } : {}),
    ...(response.retryable !== undefined
      ? { responseRetryable: response.retryable }
      : {}),
    ...(response.deployError
      ? { responseDeployError: response.deployError }
      : {}),
    ...(failure.upstream ? { upstream: failure.upstream } : {}),
    ...(failure.upstreamStatus !== undefined
      ? { upstreamStatus: failure.upstreamStatus }
      : {}),
    ...(failure.requestError ? { requestError: failure.requestError } : {}),
    ...(failure.localDiagnostic
      ? { localDiagnostic: failure.localDiagnostic }
      : {}),
  };
}

function isHttpStatus(value: number | undefined): value is number {
  return (
    Number.isInteger(value) &&
    value !== undefined &&
    value >= 100 &&
    value <= 599
  );
}
