import type { ProxyFailure } from "@aomi-labs/account";
import type { DeployErrorDetail } from "@aomi-labs/deploy";

export type BffService = "portal-bff" | "build-bff";

export type BffUpstream = "rust" | "github" | "vercel" | "supabase";

export type FailureAction = "issue" | "log" | "ignore";

export type FailureReason =
  | "expected"
  | "local_exception"
  | "upstream_request_failed"
  | "upstream_response_failed"
  | "service_credential_rejected"
  | "invalid_upstream_status";

export type PublicFailure = {
  status: number;
  error: string;
  /**
   * Stable machine-readable identifier for the failure, when the caller needs
   * to branch on it. The human message is not a contract; this is.
   */
  code?: string;
  /**
   * Whether retrying the same request could plausibly succeed. `false` marks
   * an operator problem (a missing deploy-time credential, say) where telling
   * the user to try again is the wrong instruction.
   */
  retryable?: boolean;
  /**
   * The Manager's structured deploy failure, forwarded verbatim so the
   * browser can render its hint and branch on its code.
   */
  deployError?: DeployErrorDetail;
};

export type LocalDiagnosticValue = string | number | boolean | null;

export type LocalDiagnostic = {
  kind: string;
  attributes?: Record<string, LocalDiagnosticValue>;
};

export type FailureContext = {
  routeFamily: string;
  operation: string;
  method?: string;
  durationMs?: number;
  smokeTest?: boolean;
};

export type RequestErrorDetails = {
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  };
  errorContext: {
    routerKind: string;
    routePath: string;
    routeType: string;
  };
};

type ContextualFailure = { context: FailureContext };

export type FailureInput =
  | (ContextualFailure & {
      source: "expected";
      error?: unknown;
      response: PublicFailure;
      localDiagnostic?: LocalDiagnostic;
    })
  | (ContextualFailure & {
      source: "local";
      error: unknown;
      response?: PublicFailure;
      handled?: boolean;
    })
  | (ContextualFailure & {
      source: "upstream_request";
      upstream: BffUpstream;
      error: unknown;
      response?: PublicFailure;
    })
  | (ContextualFailure & {
      source: "upstream_response";
      upstream: BffUpstream;
      status: number;
      credential?: "service" | "user";
      error?: unknown;
      response?: PublicFailure;
    })
  | (ContextualFailure & {
      source: "launch";
      error: unknown;
    })
  | {
      source: "proxy";
      failure: ProxyFailure;
    }
  | (ContextualFailure & {
      source: "artifact";
      error: unknown;
    })
  | (ContextualFailure &
      RequestErrorDetails & {
        source: "uncaught";
        error: unknown;
      });

export type IdentifiedFailure = {
  origin: "expected" | "local" | "upstream_request" | "upstream_response";
  error: unknown;
  context: FailureContext;
  handled: boolean;
  upstream?: BffUpstream;
  upstreamStatus?: number;
  credential?: "service" | "user";
  responseHint?: PublicFailure;
  requestError?: RequestErrorDetails;
  localDiagnostic?: LocalDiagnostic;
};

export type FailureDecision = {
  action: FailureAction;
  reason: FailureReason;
  error: unknown;
  context: FailureContext;
  handled: boolean;
  responseStatus: number;
  responseError: string;
  responseCode?: string;
  responseRetryable?: boolean;
  responseDeployError?: DeployErrorDetail;
  upstream?: BffUpstream;
  upstreamStatus?: number;
  requestError?: RequestErrorDetails;
  localDiagnostic?: LocalDiagnostic;
};

export type FailureResult = FailureDecision & { response: Response };

export type FailurePipeline = {
  handle(input: FailureInput): FailureResult;
};
