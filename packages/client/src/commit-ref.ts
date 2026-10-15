/**
 * Thread-less commit refs (Agent Wallets v1, step 2).
 *
 * HAND-WRITTEN WIRE TYPES, matching product-mono 2b801a8f6. Until the generated
 * agent API (packages/client/src/generated/agent-v1) is regenerated from that
 * backend, everything the frontend knows about `/v1/commits/:commit_ref`,
 * `CommitRefView` and thread `origin` lives in this one file. After
 * `pnpm generate:agent-api`, swap (keeping these names as aliases):
 *   - `CommitRefView`             -> components["schemas"]["CommitRefView"]
 *   - `ThreadOrigin`              -> components["schemas"]["ThreadOrigin"]
 *   - `CommitRefSignRequest`      -> components["schemas"]["CommitRefSign"]
 *   - `CommitRefBroadcastRequest` -> components["schemas"]["CommitRefBroadcast"]
 *   - `CommitRefRejectRequest`    -> components["schemas"]["CommitRefReject"]
 *   - `SessionOriginFields`       -> drop once `Session` carries `origin`
 *     (keep `origin_app` optional; sessions do not send it yet)
 * The paths, error codes and error parsing below stay hand-written.
 */
import { AomiApiError, apiErrorFields } from "./api-error";
import type { CommitView } from "./commits";
import { asRecord, stringValue } from "./internal/record";

/** Where a thread was started. Set once, badge only; unset threads read as portal. */
export type ThreadOrigin =
  | "portal"
  | "widget"
  | "cli"
  | "sdk"
  | "mcp"
  | "api"
  | "telegram"
  | "cron";

/** `CommitView` (flattened) plus the step 2 ref fields. */
export type CommitRefView = CommitView & {
  origin: ThreadOrigin;
  /** Application id when the commit's thread runs inside an app. */
  origin_app: number | null;
  /** Client that created the commit, from the bearer's `auth_source`. */
  initiator: string;
  /** Where the commit's card or receipt goes; same vocabulary as `initiator`. */
  notify: string;
  /** Absolute `<portal origin>/sign/<commit_id>`. */
  sign_url: string;
  /** Unix seconds. */
  created_at: number;
};

/**
 * `origin` on `/v1/agent/sessions` items; older servers omit it. Sessions do
 * not carry `origin_app` (threads store no app), so the app badge stays dark
 * until a later step adds it.
 */
export type SessionOriginFields = {
  origin?: ThreadOrigin | null;
  origin_app?: number | null;
};

export type CommitRefSignRequest = {
  version: number;
  review_digest: string;
  payloads: string[];
};
export type CommitRefBroadcastRequest = {
  version: number;
  review_digest: string;
  transaction_id: string;
};
export type CommitRefRejectRequest = { version: number };

const ref = (value: string) => `/v1/commits/${encodeURIComponent(value)}`;

/** Every `/v1/commits/:ref` route. Old thread-scoped routes stay in commits.ts. */
export const commitRefPaths = {
  view: ref,
  sign: (value: string) => `${ref(value)}/sign`,
  broadcast: (value: string) => `${ref(value)}/broadcast`,
  reject: (value: string) => `${ref(value)}/reject`,
  attempts: (value: string) => `${ref(value)}/attempts`,
  report: (value: string, attempt: string) =>
    `${ref(value)}/attempts/${encodeURIComponent(attempt)}/report`,
} as const;

export const COMMIT_REF_ERROR_CODES = {
  notFound: "commit_not_found",
  versionConflict: "commit_version_conflict",
  digestMismatch: "commit_review_digest_mismatch",
} as const;

/** The ref does not exist or belongs to another account (never a 403). */
export class CommitNotFoundError extends AomiApiError {
  constructor(message: string, requestId?: string, details?: unknown) {
    super(
      404,
      COMMIT_REF_ERROR_CODES.notFound,
      message,
      false,
      requestId,
      details,
    );
    this.name = "CommitNotFoundError";
  }
}

/**
 * The reviewed version or review digest is no longer current. Refresh, review
 * again and retry. Raised for a server 409 and for the same check done locally
 * before any wallet prompt.
 */
export class CommitStaleError extends AomiApiError {
  constructor(
    code:
      | typeof COMMIT_REF_ERROR_CODES.versionConflict
      | typeof COMMIT_REF_ERROR_CODES.digestMismatch,
    message: string,
    requestId?: string,
    details?: unknown,
  ) {
    super(409, code, message, false, requestId, details);
    this.name = "CommitStaleError";
  }
}

/**
 * Typed error for a failed `/v1/commits` response. The backend answers
 * `{code, status}`; api-server (OAuth clients) wraps it as
 * `{error: {code, message, details}}`. Both map by status and code. The
 * message keeps the `HTTP <status>` prefix CommitController uses to tell a
 * definite rejection from an ambiguous one.
 */
export function commitRefError(
  status: number,
  statusText: string,
  body: unknown,
): AomiApiError {
  const fields = apiErrorFields(body);
  const code =
    fields.code ?? stringValue(asRecord(body)?.code) ?? `http_${status}`;
  const message = `HTTP ${status}: ${fields.message ?? (statusText || code)}`;
  if (status === 404 && code === COMMIT_REF_ERROR_CODES.notFound)
    return new CommitNotFoundError(message, fields.requestId, fields.details);
  if (
    status === 409 &&
    (code === COMMIT_REF_ERROR_CODES.versionConflict ||
      code === COMMIT_REF_ERROR_CODES.digestMismatch)
  )
    return new CommitStaleError(
      code,
      message,
      fields.requestId,
      fields.details,
    );
  return new AomiApiError(
    status,
    code,
    message,
    undefined,
    fields.requestId,
    fields.details,
  );
}
