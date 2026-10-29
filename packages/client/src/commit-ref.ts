/** Thread-less commit refs: `/v1/commits/:commit_ref` paths, views and errors. */
import { AomiApiError, apiErrorFields } from "./api-error";
import type { CommitView } from "./commits";
import type { components } from "./generated/agent-v1/types";
import { asRecord, stringValue } from "./internal/record";

type Schemas = components["schemas"];

/** Where a thread was started. Set once, badge only; unset threads read as portal. */
export type ThreadOrigin = Schemas["ThreadOrigin"];

/** `CommitView` (with the message and bundle additions) plus the ref fields. */
export type CommitRefView = CommitView &
  Omit<Schemas["CommitRefView"], keyof Schemas["CommitView"]>;

/**
 * `/v1/agent/sessions` items also carry `awaitingApproval`: refs waiting for
 * approval on the thread and its scheduled-run children, oldest first, at
 * most 5. Omitted when there are none.
 */
export type SessionApprovalFields = { awaitingApproval?: string[] };

const ref = (value: string) => `/v1/commits/${encodeURIComponent(value)}`;

/** Every `/v1/commits/:ref` route. Old thread-scoped routes stay in commits.ts. */
export const commitRefPaths = {
  view: ref,
  sign: (value: string) => `${ref(value)}/sign`,
  broadcast: (value: string) => `${ref(value)}/broadcast`,
  reject: (value: string) => `${ref(value)}/reject`,
  approve: (value: string) => `${ref(value)}/approve`,
  attempts: (value: string) => `${ref(value)}/attempts`,
  report: (value: string, attempt: string) =>
    `${ref(value)}/attempts/${encodeURIComponent(attempt)}/report`,
} as const;

export const COMMIT_REF_ERROR_CODES = {
  notFound: "commit_not_found",
  versionConflict: "commit_version_conflict",
  digestMismatch: "commit_review_digest_mismatch",
  approvalForbidden: "commit_approval_forbidden",
  notAwaitingApproval: "commit_not_awaiting_approval",
  expired: "commit_expired",
  /** The agent wallet (or every agent wallet) is paused. */
  walletPaused: "commit_wallet_paused",
  walletArchived: "commit_wallet_archived",
  /** The connection that asked has no access to this agent wallet. */
  walletNoAccess: "commit_wallet_no_access",
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
 * This session may not approve: a portal or CLI login can, and an OAuth
 * client (MCP, API, SDK) only its own commits where its lane is Ask in that
 * client. Anyone else, widget embeds and guests included, opens `sign_url`.
 */
export class CommitApprovalForbiddenError extends AomiApiError {
  constructor(message: string, requestId?: string, details?: unknown) {
    super(
      403,
      COMMIT_REF_ERROR_CODES.approvalForbidden,
      message,
      false,
      requestId,
      details,
    );
    this.name = "CommitApprovalForbiddenError";
  }
}

/** The commit expired before or during approval. Nothing was signed. */
export class CommitExpiredError extends AomiApiError {
  constructor(message: string, requestId?: string, details?: unknown) {
    super(
      410,
      COMMIT_REF_ERROR_CODES.expired,
      message,
      false,
      requestId,
      details,
    );
    this.name = "CommitExpiredError";
  }
}

/**
 * The commit is not waiting for approval: it signs in a wallet, was already
 * rejected, or has moved on.
 */
export class CommitNotAwaitingApprovalError extends AomiApiError {
  constructor(message: string, requestId?: string, details?: unknown) {
    super(
      409,
      COMMIT_REF_ERROR_CODES.notAwaitingApproval,
      message,
      false,
      requestId,
      details,
    );
    this.name = "CommitNotAwaitingApprovalError";
  }
}

/**
 * Typed error for a failed `/v1/commits` response. The backend answers
 * `{code, status}` (a wallet refusal adds `agent_wallet_id`, `wallet_name` and
 * `connection_key`, kept as `details`); api-server (OAuth clients) wraps it
 * as `{error: {code, message, details}}`. Both map by status and code. The
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
  if (status === 403 && code === COMMIT_REF_ERROR_CODES.approvalForbidden)
    return new CommitApprovalForbiddenError(
      message,
      fields.requestId,
      fields.details,
    );
  if (status === 410)
    return new CommitExpiredError(message, fields.requestId, fields.details);
  if (status === 409 && code === COMMIT_REF_ERROR_CODES.notAwaitingApproval)
    return new CommitNotAwaitingApprovalError(
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
    fields.details ?? (fields.code ? undefined : asRecord(body)),
  );
}
