import { SUPPORTED_CHAINS } from "../chains";
import {
  policyKey,
  type AomiPolicy,
  type AomiPolicyCatalog,
  type AomiPolicyTo,
} from "./policy";

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

/** Base units ("500000000") as a human amount ("0.5"), trailing zeros dropped. */
export function fromBaseUnits(amount: string, decimals: number): string {
  const digits = amount.padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** The CAIP-2 chain of an asset id: `eip155:8453`, `solana:mainnet-beta`. */
export const assetNetwork = (asset: string) => asset.split("/")[0]!;

/** The chain an asset id lives on, by name. */
export function assetChain(asset: string, catalog?: AomiPolicyCatalog): string {
  const known = catalog?.tokens.find((token) => token.asset === asset)?.chain;
  if (known) return known;
  const [namespace, reference] = assetNetwork(asset).split(":");
  if (namespace === "solana") return "Solana";
  const chain = SUPPORTED_CHAINS.find((item) => String(item.id) === reference);
  return chain?.name ?? `Chain ${reference ?? ""}`.trim();
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

/** The policies without the one with this id. */
export const withoutPolicy = (
  policies: readonly AomiPolicy[],
  id: string,
): AomiPolicy[] =>
  policies.filter((held) => (held.id ?? policyKey(held)) !== id);

/** The catalog's CAIP-2 networks a person means by `chain`: a name, an id or `solana`. */
function networksOf(catalog: AomiPolicyCatalog, chain: string): string[] {
  const wanted = chain.trim().toLowerCase();
  const all = [
    ...catalog.tokens.map((token) => ({
      network: assetNetwork(token.asset),
      name: token.chain || assetChain(token.asset),
    })),
    ...catalog.apps.flatMap((app) =>
      app.chains.map((network) => ({
        network,
        name: assetChain(`${network}/`),
      })),
    ),
  ];
  return [
    ...new Set(
      all
        .filter(({ network, name }) => {
          const [namespace, reference] = network.split(":");
          return [network, name.toLowerCase(), reference, namespace].includes(
            wanted,
          );
        })
        .map(({ network }) => network),
    ),
  ];
}

/** The catalog on one chain; `chain` is a name, a CAIP-2 id or a chain id. */
export function catalogOn(
  catalog: AomiPolicyCatalog,
  chain: string,
): AomiPolicyCatalog {
  const networks = networksOf(catalog, chain);
  if (!networks.length)
    throw new Error(`chain: no chain ${chain} in the catalog`);
  return {
    apps: catalog.apps.filter((app) =>
      app.chains.some((network) => networks.includes(network)),
    ),
    tokens: catalog.tokens.filter((token) =>
      networks.includes(assetNetwork(token.asset)),
    ),
  };
}
