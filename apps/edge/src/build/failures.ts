import { identifyLaunchError } from "@aomi-labs/internal";

import { EdgeError, errorResponse, logFailure } from "../kernel/errors";

/**
 * A Build failure as the kernel's EdgeError: edge faults pass through, and
 * anything the manager client threw is identified as a launch error with the
 * `{ error, code?, retryable?, deployError? }` body Build's UI reads.
 */
export function buildError(error: unknown): EdgeError {
  if (error instanceof EdgeError) return error;
  const { response } = identifyLaunchError(error);
  return new EdgeError(response.status, response.error, {
    cause: error,
    body: {
      ...(response.code ? { code: response.code } : {}),
      ...(response.retryable !== undefined ? { retryable: response.retryable } : {}),
      ...(response.deployError ? { deployError: response.deployError } : {}),
    },
  });
}

export function failureResponse(error: unknown, request: Request, operation: string): Response {
  return errorResponse(buildError(error), { surface: "build", operation, request });
}

/** Log a failure that is dropped rather than answered (one source of a fan-out). */
export function reportFailure(error: unknown, request: Request, operation: string): void {
  logFailure(buildError(error), { surface: "build", operation, request });
}
