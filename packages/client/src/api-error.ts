import { asRecord, stringValue } from "./internal/record";

/** A failed Aomi HTTP API call, whichever transport made it. */
export class AomiApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean = isRetryableStatus(status),
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AomiApiError";
  }
}

export type ApiErrorFields = {
  code?: string;
  message?: string;
  requestId?: string;
  details?: unknown;
};

/**
 * Read an Aomi error body. Backends answer either `{ error: "code" }` or
 * `{ error: { code, message, requestId, details } }`; some routes add a
 * top-level `message`.
 */
export function apiErrorFields(body: unknown): ApiErrorFields {
  const record = asRecord(body);
  const error = record?.error;
  const nested = asRecord(error);
  return {
    code: stringValue(error) ?? stringValue(nested?.code),
    message: stringValue(nested?.message) ?? stringValue(record?.message),
    requestId: stringValue(nested?.requestId),
    details: nested?.details,
  };
}

/** Timeouts, rate limits and server errors are worth retrying. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
