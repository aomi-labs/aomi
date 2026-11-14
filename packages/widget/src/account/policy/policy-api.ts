import {
  AccountGraphApiError,
  type AccountPoliciesTransport,
  type AomiBindOnchainPolicy,
  type AomiPreparedOnchainPolicy,
} from "@aomi-labs/client";

type PolicyApiError = { error?: string; error_code?: string };

function parsePolicyError(cause: unknown): PolicyApiError {
  if (cause instanceof AccountGraphApiError)
    return (cause.body ?? {}) as PolicyApiError;
  try {
    return JSON.parse(
      cause instanceof Error ? cause.message : String(cause),
    ) as PolicyApiError;
  } catch {
    return {};
  }
}

export function policyErrorCode(cause: unknown): string | undefined {
  return parsePolicyError(cause).error_code;
}

/**
 * The backend gates the whole Swig provider behind one deployment flag and
 * answers 404 with these codes when it is off. The settings section renders
 * nothing in that case, so production stays untouched until the flag flips.
 */
export function isPolicyProviderUnavailable(cause: unknown): boolean {
  const code = policyErrorCode(cause);
  return code === "swig_disabled" || code === "policy_provider_not_found";
}

// The wallet and the backend read the chain through different RPC nodes, so a
// confirm can land before the backend's node shows the transaction.
const UNSETTLED = new Set([
  "policy_not_confirmed",
  "swig_not_found",
  "role_still_active",
]);

async function settled<T>(
  confirm: () => Promise<T>,
  retryDelayMs: number,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await confirm();
    } catch (cause) {
      if (attempt >= 5 || !UNSETTLED.has(policyErrorCode(cause) ?? ""))
        throw cause;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

/** Confirm a binding, retrying while the backend's node catches up. */
export function confirmPolicy(
  policies: AccountPoliciesTransport,
  body: AomiBindOnchainPolicy,
  retryDelayMs = 2_000,
): Promise<AomiPreparedOnchainPolicy> {
  return settled(() => policies.confirm(body), retryDelayMs);
}

/** Confirm a revoke, retrying while the backend's node catches up. */
export function confirmPolicyRevoke(
  policies: AccountPoliciesTransport,
  bindingId: number,
  signature: string,
  retryDelayMs = 2_000,
): Promise<AomiPreparedOnchainPolicy> {
  return settled(
    () => policies.confirmRevoke(bindingId, signature),
    retryDelayMs,
  );
}

/**
 * Decimal places for the curated mints the backend offers, keyed by the
 * symbol it labels them with. A symbol missing here shows its raw amount.
 */
export const MINT_DECIMALS: Record<string, number> = {
  wSOL: 9,
  USDC: 6,
  USDT: 6,
};

export function fromAtomic(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function atomicToSol(value: string): string {
  return fromAtomic(value, 9);
}

export function explainPolicyError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  if (/user rejected|user denied|4001/i.test(raw))
    return "Signature declined — nothing changed.";
  const { error, error_code } = parsePolicyError(cause);
  if (error_code === "stale_policy_binding")
    return "This policy changed elsewhere. Review the latest version and try again.";
  if (error) return error;
  return raw.startsWith("{") || !raw
    ? "Policy update failed. Refresh and try again."
    : raw;
}
