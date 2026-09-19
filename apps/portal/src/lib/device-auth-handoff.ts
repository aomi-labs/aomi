/**
 * Shared browser-side handoff logic for the CLI login surfaces
 * (`/device-auth` and `/oauth/device`). Failures carry a stable code so the
 * page can show a next step without ever rendering provider or HTTP bodies.
 */

export type DeviceAuthHandoffCode =
  | "provider_login_cancelled"
  | "provider_credential_timeout"
  | "provider_account_conflict"
  | "provider_exchange_rate_limited"
  | "provider_exchange_failed"
  | "device_grant_failed"
  | "device_link_failed";

export class DeviceAuthHandoffError extends Error {
  readonly code: DeviceAuthHandoffCode;
  readonly status?: number;

  constructor(code: DeviceAuthHandoffCode, status?: number) {
    super(handoffFailureMessage(code));
    this.name = "DeviceAuthHandoffError";
    this.code = code;
    this.status = status;
  }
}

export function isDeviceAuthHandoffError(
  error: unknown,
): error is DeviceAuthHandoffError {
  return (
    error instanceof DeviceAuthHandoffError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "DeviceAuthHandoffError" &&
      typeof (error as { code?: unknown }).code === "string")
  );
}

export function handoffFailureMessage(code: DeviceAuthHandoffCode): string {
  switch (code) {
    case "provider_login_cancelled":
      return "Sign-in was cancelled. Continue again when you are ready.";
    case "provider_credential_timeout":
      return "The provider signed you in but did not issue a credential in time. Try again.";
    case "provider_account_conflict":
      return "This login is already linked to a different Aomi account. Sign in with that account, or unlink it there first.";
    case "provider_exchange_rate_limited":
      return "Too many sign-in attempts. Wait a minute and try again.";
    case "provider_exchange_failed":
      return "Aomi could not verify the provider credential.";
    case "device_grant_failed":
      return "Aomi could not create the CLI login grant.";
    case "device_link_failed":
      return "Aomi could not link this login method.";
  }
}

/** Provider exchange responses map onto codes the user can act on. */
export function providerExchangeFailure(
  status: number,
): DeviceAuthHandoffError {
  if (status === 409) {
    return new DeviceAuthHandoffError("provider_account_conflict", status);
  }
  if (status === 429) {
    return new DeviceAuthHandoffError("provider_exchange_rate_limited", status);
  }
  return new DeviceAuthHandoffError("provider_exchange_failed", status);
}

export function deviceGrantFailure(
  status: number,
  purpose: "login" | "link",
): DeviceAuthHandoffError {
  if (status === 429) {
    return new DeviceAuthHandoffError("provider_exchange_rate_limited", status);
  }
  return new DeviceAuthHandoffError(
    purpose === "link" ? "device_link_failed" : "device_grant_failed",
    status,
  );
}

export type ProviderCredentialGetter = (options?: {
  fresh?: boolean;
}) => Promise<unknown> | undefined;

/**
 * How long the page keeps asking the provider for a credential after it
 * reports authentication. Para can answer `issueJwt` with 403 for a few
 * seconds after login; its own getter backs off for 30 seconds on that, which
 * `fresh` bypasses. The budget stays well inside the CLI's five-minute
 * loopback window.
 */
export const DEVICE_AUTH_CREDENTIAL_BUDGET_MS = 90_000;
export const DEVICE_AUTH_CREDENTIAL_INTERVAL_MS = 1_500;

export async function waitForProviderCredential(
  getCredential: ProviderCredentialGetter,
  options: {
    budgetMs?: number;
    intervalMs?: number;
    isCancelled?: () => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<unknown> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const isCancelled = options.isCancelled ?? (() => false);
  const budgetMs = options.budgetMs ?? DEVICE_AUTH_CREDENTIAL_BUDGET_MS;
  const intervalMs = options.intervalMs ?? DEVICE_AUTH_CREDENTIAL_INTERVAL_MS;
  const deadline = now() + budgetMs;
  for (;;) {
    if (isCancelled()) {
      throw new DeviceAuthHandoffError("provider_login_cancelled");
    }
    const credential = await getCredential({ fresh: true });
    if (credential) return credential;
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new DeviceAuthHandoffError("provider_credential_timeout");
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
