/**
 * The one failure type. Anything a handler throws ends up as an EdgeError (or
 * is treated as an unexpected 500) and becomes `{ error: code, ...body }`.
 * Server faults are logged with their cause; the cause never reaches the body.
 */
export class EdgeError extends Error {
  readonly headers: Headers;
  readonly body: Record<string, unknown>;

  constructor(
    readonly status: number,
    readonly code: string,
    options: { cause?: unknown; headers?: HeadersInit; body?: Record<string, unknown> } = {},
  ) {
    super(code, { cause: options.cause });
    this.name = "EdgeError";
    this.headers = new Headers(options.headers);
    this.body = options.body ?? {};
  }
}

/** The upstream could not be reached at all, as opposed to answering with an error. */
export const unreachable = (cause: unknown) => new EdgeError(502, "upstream_unavailable", { cause });

/** Signing a backend bearer failed: a server fault, never the caller's. */
export async function minted<T>(mint: () => Promise<T>): Promise<T> {
  try {
    return await mint();
  } catch (cause) {
    throw new EdgeError(502, "bearer_mint_failed", { cause });
  }
}

function describe(value: unknown): string {
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
}

export type FailureScope = { surface: string; operation: string; request: Request };

/** Log a failure that is the edge's or an upstream's fault. */
export function logFailure(error: unknown, scope: FailureScope, extra: Record<string, unknown> = {}): void {
  const { pathname } = new URL(scope.request.url);
  console.error(`edge.${scope.surface}.failure`, {
    operation: scope.operation,
    method: scope.request.method,
    path: pathname,
    ...(error instanceof EdgeError
      ? { status: error.status, code: error.code, cause: describe(error.cause) }
      : { status: 500, error: describe(error) }),
    ...extra,
  });
}

export function errorResponse(error: unknown, scope: FailureScope, fallback = "internal_error"): Response {
  if (!(error instanceof EdgeError)) {
    logFailure(error, scope);
    return Response.json({ error: fallback }, { status: 500 });
  }
  if (error.status >= 500) logFailure(error, scope);
  const headers = new Headers(error.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: error.code, ...error.body }), {
    status: error.status,
    headers,
  });
}
