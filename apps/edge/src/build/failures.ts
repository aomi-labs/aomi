import { identifyLaunchError } from "@aomi-labs/internal";

import { BearerMintError } from "../portal/errors";
import { UpstreamUnreachableError } from "../portal/forward";

export type FailureContext = { routeFamily: string; operation: string; method: string };

export function failureContext(request: Request, operation: string): FailureContext {
  return { routeFamily: new URL(request.url).pathname, operation, method: request.method };
}

/** Log one failure with its context; the body of what is logged never names a secret. */
export function reportFailure(error: unknown, context: FailureContext): void {
  const identified = identifyLaunchError(error);
  console.error("edge.build.failure", {
    ...context,
    origin: identified.origin,
    upstream: identified.upstream,
    upstreamStatus: identified.upstreamStatus,
    status: identified.response.status,
    error:
      identified.error instanceof Error
        ? `${identified.error.name}: ${identified.error.message}`
        : String(identified.error),
  });
}

/**
 * The Build BFF's failure pipeline, minus Sentry: identify the launch error,
 * log it, answer with the same `{ error, code?, retryable?, deployError? }`
 * body and status the Vercel routes send.
 */
export function failureResponse(error: unknown, context: FailureContext): Response {
  if (error instanceof BearerMintError) {
    console.error("edge.build.bearer_mint_failed", { ...context, cause: String(error.cause) });
    return Response.json({ error: "bearer_mint_failed" }, { status: 502 });
  }
  if (error instanceof UpstreamUnreachableError) {
    console.error("edge.build.upstream_unreachable", { ...context, cause: String(error.cause) });
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }
  reportFailure(error, context);
  const { response } = identifyLaunchError(error);
  return Response.json(
    {
      error: response.error,
      ...(response.code ? { code: response.code } : {}),
      ...(response.retryable !== undefined ? { retryable: response.retryable } : {}),
      ...(response.deployError ? { deployError: response.deployError } : {}),
    },
    { status: response.status },
  );
}
