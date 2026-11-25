/**
 * Where a policy stands on chain. Aomi checks every policy on every commit;
 * a provider may hold it on chain too, and the two can differ.
 */
import {
  policyKey,
  type AomiPolicyAction,
  type AomiPolicyEnforcement,
  type AomiPolicyProvider,
  type AomiWalletPolicies,
} from "./policy";
import { assetNetwork } from "./policy-draft";

export type AomiPolicyOnChain =
  /** The chain holds the policy as it stands. */
  | { kind: "in_sync"; entry: AomiPolicyEnforcement }
  /** A provider can hold it and nothing is on chain yet. */
  | { kind: "not_deployed"; entry: AomiPolicyEnforcement }
  /** The chain holds an earlier version, or one its owner must still act on. */
  | { kind: "out_of_date"; entry: AomiPolicyEnforcement }
  /** The chain could not be read. */
  | { kind: "unverified"; entry: AomiPolicyEnforcement }
  /** Aomi no longer holds the policy; the chain still does. */
  | { kind: "chain_only"; entry: AomiPolicyEnforcement }
  /**
   * The wallet is in blacklist mode, and `provider`, on the policy's chain,
   * holds policies in whitelist mode only.
   */
  | { kind: "needs_whitelist"; provider: AomiPolicyProvider }
  /** No provider can hold it; `note` is the provider's reason, if one said. */
  | { kind: "aomi_only"; note: string | null };

/** The read of a wallet's policies a status needs; `providers` if it has them. */
type Held = Pick<AomiWalletPolicies, "rules" | "enforcement"> &
  Partial<Pick<AomiWalletPolicies, "providers">>;

// Swig and MetaMask each lower a rule only when `mode` is whitelist
// (`swig_policy.rs` `lower`, `metamask.rs` `convert`).
const WHITELIST_ONLY = ["swig", "metamask"];

/**
 * The provider on `network` that holds nothing for this wallet because it is
 * in blacklist mode: one that holds policies in whitelist mode only. Whether
 * it would hold a given policy after the switch is the provider's to say.
 */
export const whitelistOnlyProvider = (
  policies: Pick<Held, "rules" | "providers">,
  network: string,
  provider?: string,
): AomiPolicyProvider | undefined =>
  policies.rules.mode === "blacklist"
    ? policies.providers?.find(
        (one) =>
          one.network === network &&
          WHITELIST_ONLY.includes(one.provider) &&
          (!provider || one.provider === provider),
      )
    : undefined;

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
  policies: Held,
  id: string,
  provider?: string,
): AomiPolicyOnChain | null {
  const mine = policies.enforcement.filter(
    (entry) => entry.rule === id && (!provider || entry.provider === provider),
  );
  const held = policies.rules.rules.find(
    (policy) => (policy.id ?? policyKey(policy)) === id,
  );
  if (!held) {
    const entry = mine.find((candidate) => candidate.state !== "off");
    return entry ? { kind: "chain_only", entry } : null;
  }
  for (const state of ["on", "behind", "unverified"] as const) {
    const entry = mine.find((candidate) => candidate.state === state);
    // On chain, and its owner is still asked for something: not as it stands.
    if (entry)
      return {
        kind: state === "on" && entry.next ? "out_of_date" : ON_CHAIN[state],
        entry,
      };
  }
  const entry = mine.find((candidate) => candidate.ready);
  if (entry) return { kind: "not_deployed", entry };
  const waits =
    !mine.length &&
    whitelistOnlyProvider(policies, assetNetwork(held.asset), provider);
  return waits
    ? { kind: "needs_whitelist", provider: waits }
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
 * The ids `typed` names among the policies Aomi or a chain holds: that id,
 * else every id it starts. One means it is unambiguous. Nothing typed names
 * none: an empty prefix would start them all.
 */
export function matchPolicyIds(
  policies: Pick<AomiWalletPolicies, "rules" | "enforcement">,
  typed: string,
): string[] {
  const ids = [
    ...policies.rules.rules.map((policy) => policy.id ?? policyKey(policy)),
    ...chainOnlyPolicies(policies),
  ];
  if (!typed.trim()) return [];
  return ids.includes(typed)
    ? [typed]
    : ids.filter((id) => id.startsWith(typed));
}

/**
 * The action `prepare` answers for the entry, to show before asking; null
 * when it asks for none and `confirm` alone finishes. The entry's `next`
 * says it, except for `inForce`, a removal of a policy Aomi still holds,
 * which `next` does not describe: a Solana provider takes a transaction, an
 * EVM one a signature, and a signed revocation is sent as a transaction.
 */
export const expectedPolicyAction = (
  entry: Pick<AomiPolicyEnforcement, "signer" | "next">,
  { remove = false, inForce = false } = {},
): AomiPolicyAction["kind"] | null =>
  !(remove && inForce)
    ? entry.next
    : entry.signer.family === "svm"
      ? "transaction"
      : entry.next === "evm_transaction"
        ? "evm_transaction"
        : "typed_data";
