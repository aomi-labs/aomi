export const REQUIRED_SECRETS_CHECK_UNAVAILABLE =
  "REQUIRED_SECRETS_CHECK_UNAVAILABLE" as const;

/**
 * Why the check could not answer. All of these close the gate, but they are
 * not the same problem and the builder can only act on one of them:
 *
 * - `bff_misconfigured`: the caller passed no GitHub token (the edge's
 *   `BUILD_GITHUB_TOKEN`). Retrying can never fix it; it needs an operator.
 *   Telling a builder to "try again" here is the wrong instruction, which is
 *   why it is not folded in with the rest.
 * - `github_unavailable` / `backend_unavailable` — transient upstream; retry
 *   is the right advice.
 * - `unresolvable_project` — no platform repo for the project yet.
 */
export type RequiredSecretsCheckReason =
  | "bff_misconfigured"
  | "github_unavailable"
  | "backend_unavailable"
  | "unresolvable_project";

/** The required-secret metadata could not be verified safely. */
export class RequiredSecretsCheckError extends Error {
  readonly code = REQUIRED_SECRETS_CHECK_UNAVAILABLE;
  readonly reason: RequiredSecretsCheckReason;
  readonly retryable: boolean;
  readonly upstream?: "github" | "rust";
  readonly upstreamStatus?: number;

  constructor(options?: {
    cause?: unknown;
    reason?: RequiredSecretsCheckReason;
    upstream?: "github" | "rust";
    upstreamStatus?: number;
  }) {
    const reason = options?.reason ?? "github_unavailable";
    super(
      reason === "bff_misconfigured"
        ? "Required secrets cannot be verified: this deployment is missing its GitHub token."
        : "Unable to verify required secrets. Try again.",
      { cause: options?.cause },
    );
    this.name = "RequiredSecretsCheckError";
    this.reason = reason;
    this.retryable = reason !== "bff_misconfigured";
    this.upstream = options?.upstream;
    this.upstreamStatus = options?.upstreamStatus;
  }
}
