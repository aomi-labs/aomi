import type {
  AomiAccountProfile,
  AomiBindOnchainPolicy,
  AomiOnchainAddress,
  AomiOnchainPolicy,
  AomiOnchainPolicyProviderCtx,
  AomiPreparedOnchainPolicy,
} from "@aomi-labs/client";
import type { ShellRequest } from "../../transport";

export function fetchPolicy(
  chainRef: string,
  request: ShellRequest,
): Promise<[AomiAccountProfile, AomiOnchainPolicyProviderCtx]> {
  return Promise.all([
    request<AomiAccountProfile>("/api/account"),
    request<AomiOnchainPolicyProviderCtx>(
      `/api/account/onchain-policies/swig?chain_ref=${encodeURIComponent(chainRef)}`,
    ),
  ]);
}

type PolicyApiError = { error?: string; error_code?: string };

function parsePolicyError(cause: unknown): PolicyApiError {
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

export function preparePolicy(
  body: AomiBindOnchainPolicy,
  request: ShellRequest,
): Promise<AomiPreparedOnchainPolicy> {
  return request("/api/account/onchain-policies/swig/prepare", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function confirmPolicy(
  body: AomiBindOnchainPolicy,
  request: ShellRequest,
  retryDelayMs = 2_000,
): Promise<AomiPreparedOnchainPolicy> {
  return settled(
    () =>
      request("/api/account/onchain-policies/swig/confirm", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    retryDelayMs,
  );
}

export function preparePolicyRevoke(
  bindingId: number,
  request: ShellRequest,
): Promise<AomiPreparedOnchainPolicy> {
  return request(
    `/api/account/onchain-policies/swig/${bindingId}/revoke/prepare`,
    { method: "POST" },
  );
}

export function confirmPolicyRevoke(
  bindingId: number,
  signature: string,
  request: ShellRequest,
  retryDelayMs = 2_000,
): Promise<AomiPreparedOnchainPolicy> {
  return settled(
    () =>
      request(
        `/api/account/onchain-policies/swig/${bindingId}/revoke/confirm`,
        {
          method: "POST",
          body: JSON.stringify({ transaction_signature: signature }),
        },
      ),
    retryDelayMs,
  );
}

export function solToAtomic(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,9})?$/.test(normalized)) {
    throw new Error("Enter a SOL amount with at most 9 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const atomic = `${whole}${fraction.padEnd(9, "0")}`.replace(/^0+(?=\d)/, "");
  if (atomic === "0") throw new Error("The spending limit must be above zero.");
  return atomic;
}

export function atomicToSol(value: string): string {
  const padded = value.padStart(10, "0");
  const whole = padded.slice(0, -9);
  const fraction = padded.slice(-9).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function policyFromForm(
  targets: AomiOnchainAddress[],
  amount: string,
  limitKind: "lifetime" | "recurring",
  slotWindow: number,
): AomiOnchainPolicy {
  const limit =
    limitKind === "lifetime"
      ? {
          type: "lifetime_native_asset_limit" as const,
          amount: solToAtomic(amount),
        }
      : {
          type: "recurring_native_asset_limit" as const,
          amount: solToAtomic(amount),
          window: { unit: "slots" as const, value: slotWindow },
        };
  return {
    version: 1,
    rules: [
      ...targets.map((target) => ({
        type: "allowed_call_target" as const,
        target,
      })),
      limit,
    ],
  };
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
