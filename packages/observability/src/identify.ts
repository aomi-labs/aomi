import { identifyLaunchError } from "@aomi-labs/internal";

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

