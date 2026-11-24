import { policyKey, type AomiPolicy, type AomiPolicyTo } from "./policy";

/** A policy as a person writes one, on one asset. */
export type AomiPolicyDraft = {
  asset: string;
  decimals: number;
  /** As typed, in token units: `12.5`. */
  amount: string;
  to: AomiPolicyTo;
  /** Unix seconds; null is no end. */
  activeUntil?: number | null;
};

/**
 * A human amount ("0.5") as base units ("500000000"), by string math only:
 * amounts can exceed 2^53. Null when it is not a plain decimal number or has
 * more fraction digits than the token. Commas are accepted only as thousands
 * separators ("1,250"): "1,2" is a typo, never 12.
 */
export function toBaseUnits(human: string, decimals: number): string | null {
  const match = /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/.exec(human.trim());
  if (!match) return null;
  const whole = (match[1] ?? "").replace(/,/g, "");
  const fraction = match[2] ?? "";
  if (!whole && !fraction) return null;
  if (fraction.length > decimals) return null;
  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}` || "0").toString();
}

/** The draft as a policy to write; null when the amount does not fit the token. */
export function policyFromDraft(draft: AomiPolicyDraft): AomiPolicy | null {
  const amount = toBaseUnits(draft.amount, draft.decimals);
  if (amount === null) return null;
  return {
    asset: draft.asset,
    amount,
    to: draft.to,
    ...(typeof draft.activeUntil === "number"
      ? { active_until: draft.activeUntil }
      : {}),
  };
}

/**
 * The policies with `policy` added, or put in place of the one with its asset
 * and destination.
 */
export function upsertPolicy(
  policies: readonly AomiPolicy[],
  policy: AomiPolicy,
): AomiPolicy[] {
  const key = policyKey(policy);
  return policies.some((held) => policyKey(held) === key)
    ? policies.map((held) => (policyKey(held) === key ? policy : held))
    : [...policies, policy];
}
