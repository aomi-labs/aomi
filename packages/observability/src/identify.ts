import type { ProxyFailure } from "@aomi-labs/account";
import { identifyLaunchError } from "@aomi-labs/deploy/bff/errors";

import type { FailureInput, IdentifiedFailure } from "./failure";

export function identifyFailure(input: FailureInput): IdentifiedFailure {
  switch (input.source) {
    case "expected":
      return {
        origin: "expected",
        error: input.error,
        context: input.context,
        handled: true,
        responseHint: input.response,
        ...(input.localDiagnostic
          ? { localDiagnostic: input.localDiagnostic }
          : {}),
      };
    case "local":
      return {
        origin: "local",
        error: input.error,
        context: input.context,
        handled: input.handled ?? true,
        responseHint: input.response,
      };
    case "upstream_request":
      return {
        origin: "upstream_request",
        error: input.error,
        context: input.context,
        handled: true,
        upstream: input.upstream,
        responseHint: input.response,
      };
    case "upstream_response":
      return {
        origin: "upstream_response",
        error: input.error,
        context: input.context,
        handled: true,
        upstream: input.upstream,
        upstreamStatus: input.status,
        credential: input.credential,
        responseHint: input.response,
      };
    case "launch":
      return identifyLaunchFailure(input.error, input.context);
    case "proxy":
      return identifyProxyFailure(input.failure);
    case "artifact":
      return {
        origin: "local",
        error: input.error,
        context: input.context,
        handled: true,
      };
    case "uncaught":
      return {
        origin: "local",
        error: input.error,
        context: input.context,
        handled: false,
        requestError: {
          request: input.request,
          errorContext: input.errorContext,
        },
      };
  }
}

function identifyLaunchFailure(
  error: unknown,
  context: IdentifiedFailure["context"],
): IdentifiedFailure {
  const identified = identifyLaunchError(error);
  return {
    origin: identified.origin,
    error: identified.error,
    context,
    handled: true,
    responseHint: identified.response,
    ...(identified.upstream ? { upstream: identified.upstream } : {}),
    ...(identified.upstreamStatus !== undefined
      ? { upstreamStatus: identified.upstreamStatus }
      : {}),
    ...(identified.credential ? { credential: identified.credential } : {}),
  };
}

function identifyProxyFailure(failure: ProxyFailure): IdentifiedFailure {
  const context = {
    routeFamily: failure.pathname,
    operation: `proxy.${failure.kind}`,
    method: failure.method,
  };
  const responseHint =
    failure.kind === "bearer_mint"
      ? { status: failure.responseStatus, error: "bearer_mint_failed" }
      : {
          status: failure.responseStatus,
          error: "upstream_unavailable",
        };

  if (failure.kind === "bearer_mint" || failure.kind === "response_transform") {
    return {
      origin: "local",
      error: failure.error,
      context,
      handled: true,
      responseHint,
    };
  }
  if (failure.kind === "upstream_request") {
    return {
      origin: "upstream_request",
      error: failure.error,
      context,
      handled: true,
      upstream: "rust",
      responseHint,
    };
  }
  return {
    origin: "upstream_response",
    error: failure,
    context,
    handled: true,
    upstream: "rust",
    upstreamStatus: failure.status,
    credential: "user",
    responseHint,
  };
}
