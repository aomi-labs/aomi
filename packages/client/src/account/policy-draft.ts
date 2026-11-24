import { SUPPORTED_CHAINS } from "../chains";
import {
  policyKey,
  type AomiPolicy,
  type AomiPolicyCatalog,
  type AomiPolicyCatalogToken,
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

/** A policy that cannot be sent: the field that is wrong, and why. */
export class AomiPolicyFieldError extends Error {
  constructor(
    readonly field: string,
    reason: string,
    /** The nearest values the catalog does have. */
    readonly nearest: string[] = [],
  ) {
    super(`${field}: ${reason}`);
    this.name = "AomiPolicyFieldError";
  }
}

const ASSET =
  /^(?:eip155:[1-9]\d*\/(?:native|erc20:0x[0-9a-fA-F]{40})|solana:[a-z-]+\/(?:native|token:[1-9A-HJ-NP-Za-km-z]{32,44}))$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POLICY_FIELDS = ["asset", "amount", "to", "active_until"];
/** Filled by the server; read from a listed policy and never written. */
const SERVER_FIELDS = ["id", "active_from", "symbol", "decimals"];

const addressOn = (network: string, address: string) =>
  (network.startsWith("eip155:") ? EVM_ADDRESS : SOLANA_ADDRESS).test(address);

/** Single-character edits between two words. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1)
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length]!;
}

/** Up to three catalog apps on `network` whose id or name is close to `id`. */
function nearestApps(catalog: AomiPolicyCatalog, network: string, id: string) {
  const wanted = id.toLowerCase();
  return catalog.apps
    .filter((app) => app.chains.includes(network))
    .map((app) => {
      const names = [app.id.toLowerCase(), app.label.toLowerCase()];
      return {
        id: app.id,
        score: names.some(
          (name) => name.includes(wanted) || wanted.includes(name),
        )
          ? 0
          : Math.min(...names.map((name) => distance(name, wanted))),
      };
    })
    .filter((app) => app.score <= Math.max(2, Math.floor(wanted.length / 3)))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((app) => app.id);
}

/**
 * `value` as a policy to write, or an `AomiPolicyFieldError` naming the first
 * field that is wrong. The same check for every way a policy is entered.
 */
export function checkPolicy(
  value: unknown,
  catalog: AomiPolicyCatalog,
  now = Date.now(),
): AomiPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AomiPolicyFieldError("policy", "must be a JSON object");
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find(
    (field) => !POLICY_FIELDS.includes(field) && !SERVER_FIELDS.includes(field),
  );
  if (unknown)
    throw new AomiPolicyFieldError(
      unknown,
      `not a policy field; use ${POLICY_FIELDS.join(", ")}`,
    );
  const { asset, amount, active_until } = record;
  if (typeof asset !== "string" || !ASSET.test(asset))
    throw new AomiPolicyFieldError(
      "asset",
      "must be an asset id such as eip155:8453/native or solana:mainnet-beta/token:<mint>",
    );
  if (typeof amount !== "string" || !/^\d+$/.test(amount))
    throw new AomiPolicyFieldError(
      "amount",
      'must be a string of base units, such as "500000000"',
    );
  const network = assetNetwork(asset);
  const chain = assetChain(asset, catalog);
  const to = record.to as Record<string, unknown> | null | undefined;
  const kind = to && typeof to === "object" ? to.kind : undefined;
  let where: AomiPolicyTo;
  if (kind === "any_protocol") where = { kind };
  else if (kind === "protocol") {
    const app = catalog.apps.find((known) => known.id === to!.id);
    if (typeof to!.id !== "string" || !app || !app.chains.includes(network))
      throw new AomiPolicyFieldError(
        "to.id",
        `no app ${JSON.stringify(to!.id)} on ${chain}`,
        typeof to!.id === "string" ? nearestApps(catalog, network, to!.id) : [],
      );
    where = { kind, id: app.id };
  } else if (kind === "address") {
    if (typeof to!.address !== "string" || !addressOn(network, to!.address))
      throw new AomiPolicyFieldError(
        "to.address",
        `not an address on ${chain}`,
      );
    where = { kind, address: to!.address };
  } else
    throw new AomiPolicyFieldError(
      "to.kind",
      "must be any_protocol, protocol or address",
    );
  if (active_until !== undefined && active_until !== null) {
    if (typeof active_until !== "number" || !Number.isInteger(active_until))
      throw new AomiPolicyFieldError("active_until", "must be unix seconds");
    if (active_until * 1000 <= now)
      throw new AomiPolicyFieldError("active_until", "must be in the future");
  }
  return {
    asset,
    amount,
    to: where,
    ...(typeof active_until === "number" ? { active_until } : {}),
  };
}

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
    throw new AomiPolicyFieldError("chain", `no chain ${chain} in the catalog`);
  return {
    apps: catalog.apps.filter((app) =>
      app.chains.some((network) => networks.includes(network)),
    ),
    tokens: catalog.tokens.filter((token) =>
      networks.includes(assetNetwork(token.asset)),
    ),
  };
}

/** A policy as a command line names one. */
export type AomiPolicyInput = {
  /** In token units: `12.5`. */
  amount: string;
  /** A catalog symbol (`USDC`) or an asset id. */
  asset: string;
  /** A catalog app id, `any` for any listed app, or an address. */
  to: string;
  /** The last day it holds, `YYYY-MM-DD` (UTC). */
  until?: string;
  /** Picks the token when its symbol is on several chains. */
  chain?: string;
};

function tokenOf(
  catalog: AomiPolicyCatalog,
  { asset, chain }: AomiPolicyInput,
): AomiPolicyCatalogToken {
  const on = chain ? catalogOn(catalog, chain) : catalog;
  const found = on.tokens.filter(
    (token) =>
      token.asset === asset ||
      token.symbol.toLowerCase() === asset.toLowerCase(),
  );
  if (found.length === 1) return found[0]!;
  if (!found.length)
    throw new AomiPolicyFieldError(
      "asset",
      `no token ${asset} in the catalog${chain ? ` on ${chain}` : ""}`,
    );
  throw new AomiPolicyFieldError(
    "chain",
    `${asset} is on ${found.map((token) => token.chain).join(", ")}; name one`,
  );
}

/** `YYYY-MM-DD` as the last second of that UTC day, in unix seconds. */
function endOfDay(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const end = match
    ? Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, 23, 59, 59)
    : NaN;
  if (Number.isNaN(end) || new Date(end).toISOString().slice(0, 10) !== day)
    throw new AomiPolicyFieldError("until", "must be a date, YYYY-MM-DD");
  return end / 1000;
}

/**
 * What a person typed as a policy to write: the token and the app come from
 * the catalog, and the result passes `checkPolicy`.
 */
export function policyFromInput(
  input: AomiPolicyInput,
  catalog: AomiPolicyCatalog,
  now = Date.now(),
): AomiPolicy {
  const token = tokenOf(catalog, input);
  const network = assetNetwork(token.asset);
  const named = input.to.trim();
  const app = catalog.apps.find(
    (known) =>
      known.id === named.toLowerCase() ||
      known.label.toLowerCase() === named.toLowerCase(),
  );
  const to: AomiPolicyTo =
    named === "any"
      ? { kind: "any_protocol" }
      : addressOn(network, named)
        ? { kind: "address", address: named }
        : { kind: "protocol", id: app?.id ?? named };
  const policy = policyFromDraft({
    asset: token.asset,
    decimals: token.decimals,
    amount: input.amount,
    to,
    activeUntil: input.until ? endOfDay(input.until) : null,
  });
  if (!policy)
    throw new AomiPolicyFieldError(
      "amount",
      `${input.amount} is not an amount of ${token.symbol} (${token.decimals} decimals)`,
    );
  return checkPolicy(policy, catalog, now);
}
