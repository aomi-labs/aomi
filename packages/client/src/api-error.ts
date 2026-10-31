import { asRecord, stringValue } from "./internal/record";

/** What to do next, for the codes a caller can act on. */
const HINTS: Record<string, string> = {
  insufficient_scope:
    "Sign in again: aomi.auth.login() (`aomi login` in the CLI)",
  invalid_token: "Sign in again: aomi.auth.login() (`aomi login` in the CLI)",
  commit_stale:
    "The commit changed since it was reviewed: refresh() and review it again",
  commit_approval_forbidden:
    "This sign-in may not approve: open the commit's signUrl",
  no_signer: "Pass signer: { evm, svm } to new Aomi()",
};

/** Codes that stand for a group of wire codes. */
const CODE_GROUPS: Record<string, readonly string[]> = {
  commit_stale: ["commit_version_conflict", "commit_review_digest_mismatch"],
};

/** Marks AomiErrors from every copy of the SDK (each subpath bundles its own). */
const AOMI_ERROR = Symbol.for("@aomi-labs/client/AomiError");

/** Every error the SDK raises: `code` says what failed, `hint` what to do. */
export class AomiError extends Error {
  readonly status?: number;
  constructor(
    readonly code: string,
    message: string = code,
    status?: number,
  ) {
    super(message);
    this.name = "AomiError";
    this.status = status;
  }

  get hint(): string | undefined {
    const group = Object.keys(CODE_GROUPS).find((name) =>
      CODE_GROUPS[name]!.includes(this.code),
    );
    return HINTS[this.code] ?? (group && HINTS[group]);
  }
}

Object.defineProperty(AomiError.prototype, AOMI_ERROR, { value: true });

/** `error` is an AomiError, with `code` (or a code in its group) when given. */
export function isAomiError(error: unknown, code?: string): error is AomiError {
  const aomi = (error as Record<symbol, unknown> | null)?.[AOMI_ERROR]
    ? (error as AomiError)
    : undefined;
  return Boolean(
    aomi &&
    (code === undefined ||
      aomi.code === code ||
      CODE_GROUPS[code]?.includes(aomi.code)),
  );
}

/** A failed Aomi HTTP API call, whichever transport made it. */
export class AomiApiError extends AomiError {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean = isRetryableStatus(status),
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(code, message, status);
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
