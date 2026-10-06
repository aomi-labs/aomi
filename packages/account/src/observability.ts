export type AccountInternalFailure =
  | { kind: "provider_wallets"; error: unknown }
  | { kind: "widget_ticket_sweep"; error: unknown }
  | { kind: "rate_limit_table"; error: unknown }
  | { kind: "guest_merge"; error: unknown };

export type ObserveAccountInternalFailure = (
  failure: AccountInternalFailure,
) => void | Promise<void>;

export type AccountDiagnosticValue = string | number | boolean | null;

export type AccountDiagnostic = {
  kind: string;
  attributes?: Record<string, AccountDiagnosticValue>;
  context: {
    routeFamily: string;
    operation: string;
    method?: string;
  };
  response: { status: number; error: string };
};

export type ObserveAccountDiagnostic = (
  diagnostic: AccountDiagnostic,
) => void | Promise<void>;

let failureObserver: ObserveAccountInternalFailure | undefined;
let diagnosticObserver: ObserveAccountDiagnostic | undefined;

export function setAccountInternalFailureObserver(
  nextObserver: ObserveAccountInternalFailure | undefined,
): void {
  failureObserver = nextObserver;
}

export function setAccountDiagnosticObserver(
  nextObserver: ObserveAccountDiagnostic | undefined,
): void {
  diagnosticObserver = nextObserver;
}

export function observeAccountInternalFailure(
  failure: AccountInternalFailure,
): void {
  try {
    absorbObserverResult(failureObserver?.(failure));
  } catch {
    // Observability is best-effort and must not alter account behavior.
  }
}

export function observeAccountDiagnostic(diagnostic: AccountDiagnostic): void {
  try {
    absorbObserverResult(diagnosticObserver?.(diagnostic));
  } catch {
    // Observability is best-effort and must not alter account behavior.
  }
}

function absorbObserverResult(result: void | Promise<void>): void {
  if (result) void result.catch(() => {});
}

export {
  setBetterAuthFailureObserver,
  type BetterAuthFailure,
  type ObserveBetterAuthFailure,
} from "./better-auth/failure-observer";
