/**
 * Where a policy stands on chain. Aomi checks every policy on every commit;
 * a provider may hold it on chain too, and the two can differ.
 */
import {
  policyKey,
  type AomiPolicyAction,
  type AomiPolicyEnforcement,
  type AomiWalletPolicies,
} from "./policy";
import { sendsRevocation } from "./policy-enforce";

export type AomiPolicyOnChain =
  /** The chain holds the policy as it stands. */
  | { kind: "in_sync"; entry: AomiPolicyEnforcement }
  /** A provider can hold it and nothing is on chain yet. */
  | { kind: "not_deployed"; entry: AomiPolicyEnforcement }
  /** The chain holds an earlier version. */
  | { kind: "out_of_date"; entry: AomiPolicyEnforcement }
  /** The chain could not be read. */
  | { kind: "unverified"; entry: AomiPolicyEnforcement }
  /** Aomi no longer holds the policy; the chain still does. */
  | { kind: "chain_only"; entry: AomiPolicyEnforcement }
  /** No provider can hold it; `note` is the provider's reason, if one said. */
  | { kind: "aomi_only"; note: string | null };

const ON_CHAIN = {
  on: "in_sync",
  behind: "out_of_date",
  unverified: "unverified",
} as const;

/**
 * The on-chain status of the policy with this id, with `provider` or any.
 * Null when neither Aomi nor a chain holds it.
 */
export function policyOnChain(
  policies: Pick<AomiWalletPolicies, "rules" | "enforcement">,
  id: string,
  provider?: string,
): AomiPolicyOnChain | null {
  const mine = policies.enforcement.filter(
    (entry) => entry.rule === id && (!provider || entry.provider === provider),
  );
  const held = policies.rules.rules.some(
    (policy) => (policy.id ?? policyKey(policy)) === id,
  );
  if (!held) {
    const entry = mine.find((candidate) => candidate.state !== "off");
    return entry ? { kind: "chain_only", entry } : null;
  }
  for (const state of ["on", "behind", "unverified"] as const) {
    const entry = mine.find((candidate) => candidate.state === state);
    if (entry) return { kind: ON_CHAIN[state], entry };
  }
  const entry = mine.find((candidate) => candidate.ready);
  return entry
    ? { kind: "not_deployed", entry }
    : { kind: "aomi_only", note: mine[0]?.note ?? null };
}

/** The ids of removed policies a chain still holds. */
export function chainOnlyPolicies(
  policies: Pick<AomiWalletPolicies, "rules" | "enforcement">,
): string[] {
  const ids = policies.enforcement.map((entry) => entry.rule);
  return [...new Set(ids)].filter(
    (id) => policyOnChain(policies, id)?.kind === "chain_only",
  );
}

/**
 * The action `prepare` answers for the entry, to show before asking: a
 * Solana provider takes a transaction, an EVM one a signature, and a signed
 * revocation is sent as a transaction.
 */
export const expectedPolicyAction = (
  entry: Pick<AomiPolicyEnforcement, "signer" | "ready" | "note">,
  remove = false,
): AomiPolicyAction["kind"] =>
  entry.signer.family === "svm"
    ? "transaction"
    : remove && sendsRevocation(entry)
      ? "evm_transaction"
      : "typed_data";
