const MAX_RETRY_AFTER_MS = 10_000;
const BASE_RETRY_DELAY_MS = 500;

type HttpRequestErrorOptions = {
  status?: number;
  body?: unknown;
  retryAfterMs?: number | null;
  retryable?: boolean;
};

/** Error metadata that lets the query layer distinguish transient failures. */
export class HttpRequestError extends Error {
  readonly status?: number;
  readonly body: unknown;
  readonly retryAfterMs: number | null;
  readonly retryable?: boolean;

  constructor(message: string, options: HttpRequestErrorOptions = {}) {
    super(message);
    this.name = "HttpRequestError";
    this.status = options.status;
    this.body = options.body;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryable = options.retryable;
  }
}

/**
 * Read a BFF JSON response. A failed status throws HttpRequestError with the
 * server's `error` text, or `${failure} (${status})` when the body has none.
 */
export async function readJsonResponse<T>(
  res: Response,
  failure: string,
): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new HttpRequestError(json.error || `${failure} (${res.status})`, {
      status: res.status,
      body: json,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
    });
  }
  return json;
}

/** Parse either Retry-After seconds or an HTTP date into a delay. */
export function parseRetryAfter(
  value: string | null,
  nowMs = Date.now(),
): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

function requestErrorMetadata(error: unknown): {
  status?: number;
  retryAfterMs: number | null;
  retryable?: boolean;
} {
  if (!error || typeof error !== "object") {
    return { retryAfterMs: null };
  }
  const candidate = error as {
    status?: unknown;
    retryAfterMs?: unknown;
    retryable?: unknown;
  };
  return {
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    retryAfterMs:
      typeof candidate.retryAfterMs === "number"
        ? candidate.retryAfterMs
        : null,
    retryable:
      typeof candidate.retryable === "boolean"
        ? candidate.retryable
        : undefined,
  };
}

/**
 * Foreground reads get at most one retry. Network and gateway failures are
 * transient; most 4xx/5xx responses are deterministic and should surface
 * immediately. A 429 is retried only when the server gives a short wait.
 */
export function shouldRetryControlPlaneQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 1) return false;
  const { status, retryAfterMs, retryable } = requestErrorMetadata(error);
  if (retryable === false) return false;
  if (retryable === true) return true;
  if (status === undefined) return true;
  if (status === 429) {
    return retryAfterMs !== null && retryAfterMs <= MAX_RETRY_AFTER_MS;
  }
  return status === 502 || status === 503 || status === 504;
}

export function controlPlaneRetryDelay(
  attemptIndex: number,
  error: unknown,
): number {
  const { retryAfterMs } = requestErrorMetadata(error);
  if (retryAfterMs !== null) return retryAfterMs;
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** attemptIndex, 2_000);
}
