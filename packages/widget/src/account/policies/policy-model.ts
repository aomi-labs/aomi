import {
  normalizeSolanaCluster,
  ruleKey,
  type AomiRule,
  type AomiRuleTo,
  type AomiRulesAdmin,
  type AomiRulesCatalog,
  type AomiRulesEnforcement,
  type AomiRulesProvider,
  type AomiWalletRules,
} from "@aomi-labs/client";
import {
  assetChain,
  assetNetwork,
  fromBaseUnits,
  shortAsset,
  toBaseUnits,
  toLabel,
} from "@/account/rules/rules-model";
import { explorerUrl, type IdentifierKind } from "@/thread/explorer-links";

/** "Policy" on screen, "rule" on the wire. One row may span chains, each with its own total. */
export type PolicyChain = {
  label: string;
  /** CAIP-2, as the rules' asset ids write it: `eip155:8453`. */
  network: string;
};

export type PolicyTo =
  | { kind: "any_app" }
  | { kind: "app"; id: string; label: string }
  | { kind: "address"; address: string };

/** Who checks a policy on chain, besides Aomi. */
export type PolicyEnforcement = {
  /** The provider's name, e.g. `Swig`; null when only Aomi enforces it. */
  name: string | null;
  /** Explorer link: the deployment tx if known, else the owner's account. */
  href?: string;
  /** The step's key, when the owner can sign it onto the chain. */
  deploy?: string;
  /** A removed policy whose revocation is signed and only needs sending. */
  send?: boolean;
  warning?: { label: string };
  note?: string;
  /** e.g. `0.4 SOL left`. */
  left?: string;
  /** `YYYY-MM-DD` the chain stops, when over a day from the policy's end. */
  chainEnd?: string;
  /** What of the policy the chain holds, when not all of it. */
  scope?: string;
};

export type Policy = {
  id: string;
  /** One rule per chain. */
  ruleIds: readonly string[];
  symbol: string;
  /** In token units, as shown: `1,000`. */
  amount: string;
  /** A zero total. */
  blocked: boolean;
  to: PolicyTo;
  chains: readonly PolicyChain[];
  /** Local `YYYY-MM-DD` days; a null end is "Always on". */
  activeFrom: string | null;
  activeUntil: string | null;
  ended: boolean;
  enforcement: PolicyEnforcement;
};

export type PolicyAuthorityWallet = {
  brand: string;
  address: string;
  /** The login that owns it, or the user's own name for it. */
  login?: string;
  family: "EVM" | "SVM";
};

export type PolicyAuthority =
  | { kind: "aomi" }
  | { kind: "wallet"; family: "EVM" | "SVM"; address: string };

/**
 * A removed policy whose deployment the chain still holds; its one step is
 * taking that off.
 */
export type RemovedPolicy = {
  /** The provider step's key, one per entry. */
  key: string;
  /** The rule's old id. */
  id: string;
  symbol: string;
  /** As far as the id says. */
  to: PolicyTo | null;
  chain: PolicyChain;
  enforcement: PolicyEnforcement;
};

export type WalletPolicies = {
  id: string;
  name: string;
  linkedOnly: boolean;
  onlyListed: boolean;
  policies: readonly Policy[];
  /** Removed policies the chain still holds. */
  removed?: readonly RemovedPolicy[];
  authority: PolicyAuthority;
  authorityWallets: readonly PolicyAuthorityWallet[];
  /** The agent stopped the wallet for today. */
  stopped?: boolean;
};

/** A token on one chain; a native token has no contract. */
export type PolicyTokenChain = {
  chain: PolicyChain;
  asset: string;
  decimals: number;
  address?: string;
  explorer?: string;
};

export type PolicyCatalog = {
  tokens: readonly { symbol: string; chains: readonly PolicyTokenChain[] }[];
  apps: readonly { id: string; label: string; chains: readonly string[] }[];
};

/** Who can hold a new policy on a network; absent means Aomi only. */
export type PolicyProviders = Readonly<
  Record<
    string,
    {
      name: string;
      /** Unknown from a backend that does not report its providers. */
      holds?: AomiRulesProvider["holds"];
      /** Shown on an app policy when the chain holds only part of it. */
      appScope?: string;
    }
  >
>;

/** What the picker hands over: one policy on each picked chain. */
export type PolicyDraft = {
  symbol: string;
  /** As typed, in token units. */
  amount: string;
  chains: readonly PolicyTokenChain[];
  to: PolicyTo;
  /** Last active local day, `YYYY-MM-DD`; null is always on. */
  activeUntil: string | null;
};

const pad = (value: number) => String(value).padStart(2, "0");
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Unix seconds as the local day they fall on, `YYYY-MM-DD`. */
export const localDay = (seconds: number) => dayOf(new Date(seconds * 1000));

export function dayFromToday(days: number, now = new Date()) {
  return dayOf(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days),
  );
}

/** The last second of a local day, as unix seconds. */
export function endOfLocalDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(
    new Date(year!, month! - 1, date!, 23, 59, 59, 999).getTime() / 1000,
  );
}

/** `2026-11-11` as `11/11/2026`. */
export function policyDay(day: string) {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

export function periodLine(
  policy: Pick<Policy, "activeFrom" | "activeUntil" | "ended">,
) {
  const end = policy.activeUntil ? policyDay(policy.activeUntil) : null;
  if (policy.ended && end) return `Ended ${end}`;
  if (!policy.activeFrom)
    return `Active period: ${
      end
        ? `starts when you sign, through ${end}`
        : "always on, starts when you sign"
    }`;
  const start = policyDay(policy.activeFrom);
  return `Active period: ${end ? `${start} – ${end}` : `Always on, since ${start}`}`;
}

const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export function policyToPhrase(to: PolicyTo) {
  if (to.kind === "any_app") return "on any protocol";
  if (to.kind === "app") return `on ${to.label}`;
  return `to ${short(to.address)}`;
}

/** What signing a policy asks, in a line; from the policy, not the signed bytes. */
export function policySummary(
  policy: Pick<Policy, "amount" | "symbol" | "blocked" | "to" | "chains"> & {
    activeUntil: string | null;
  },
) {
  const total = policy.blocked
    ? `No ${policy.symbol}`
    : `Up to ${policy.amount} ${policy.symbol}`;
  const where =
    policy.to.kind === "address"
      ? `to ${policy.to.address}`
      : policyToPhrase(policy.to);
  const chains = policy.chains.map((chain) => chain.label).join(", ");
  const end = policy.activeUntil
    ? `until ${policyDay(policy.activeUntil)}`
    : "with no end date";
  return `${total} ${where} (${chains}), ${end}`;
}

/** `1000.5` as `1,000.5`, by string: amounts can exceed 2^53. */
export function policyAmount(value: string | number) {
  const [whole = "0", fraction] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function networkExplorer(
  network: string,
  kind: IdentifierKind,
  identifier: string,
): string | undefined {
  const [namespace, reference] = network.split(":");
  const chain =
    namespace === "solana"
      ? normalizeSolanaCluster(network)
      : Number(reference);
  if (chain === null || chain === undefined || Number.isNaN(chain))
    return undefined;
  return explorerUrl(chain, kind, identifier) ?? undefined;
}

const WARNINGS: Partial<Record<AomiRulesEnforcement["state"], string>> = {
  behind: "Out of date",
  unverified: "Not verified",
};

/**
 * The backend note that marks a signed revocation waiting to be sent. The
 * entry has no field for the next step, so this only picks the row's label;
 * the wallet's action always comes from `prepare`.
 */
export const SEND_NOTE_PREFIX = "Your revocation is signed. Send it";

export const sendsRevocation = (
  entry: Pick<AomiRulesEnforcement, "ready" | "note">,
) => entry.ready && Boolean(entry.note?.startsWith(SEND_NOTE_PREFIX));

/** One provider's step for one rule on one network. */
export const enforcementKey = (
  entry: Pick<AomiRulesEnforcement, "provider" | "network" | "rule">,
) => `${entry.provider}:${entry.network}:${entry.rule}`;

const DAY = 86_400;

type PolicyUnits = { symbol: string; decimals?: number | null };

const leftLine = (left: string, symbol: string, decimals?: number | null) =>
  `${
    typeof decimals === "number"
      ? policyAmount(fromBaseUnits(left, decimals))
      : left
  } ${symbol} left`;

/**
 * A rule's "Onchain Enforcement" line. No entry, or one off and not ready (a
 * provider declining), means only Aomi enforces it.
 */
export function ruleEnforcement(
  rule: Pick<AomiRule, "id" | "asset" | "to" | "active_until">,
  entries: readonly AomiRulesEnforcement[],
  units?: PolicyUnits,
): PolicyEnforcement {
  const id = rule.id ?? ruleKey(rule);
  const mine = entries.filter((entry) => entry.rule === id);
  const entry =
    mine.find((candidate) => candidate.ready) ??
    mine.find((candidate) => candidate.state === "on") ??
    mine.find((candidate) => WARNINGS[candidate.state]) ??
    mine[0];
  if (!entry) return { name: null };
  if (entry.state === "off" && !entry.ready)
    return { name: null, ...(entry.note ? { note: entry.note } : {}) };
  const label = WARNINGS[entry.state];
  const left = entry.state === "off" ? null : entry.left;
  const symbol = units?.symbol ?? shortAsset(rule.asset);
  return {
    name: entry.name,
    ...(entry.state === "off" ? {} : { href: deploymentLink(entry) }),
    ...(entry.ready ? { deploy: enforcementKey(entry) } : {}),
    ...(label ? { warning: { label } } : {}),
    ...(entry.note ? { note: entry.note } : {}),
    ...(left !== null ? { left: leftLine(left, symbol, units?.decimals) } : {}),
    ...(typeof entry.expires_at === "number" &&
    (typeof rule.active_until !== "number" ||
      Math.abs(entry.expires_at - rule.active_until) > DAY)
      ? { chainEnd: localDay(entry.expires_at) }
      : {}),
  };
}

function deploymentLink(entry: AomiRulesEnforcement): string | undefined {
  const tx = entry.deployment_tx
    ? networkExplorer(entry.network, "tx", entry.deployment_tx)
    : undefined;
  const account = entry.account ?? entry.signer.address;
  return (
    tx ??
    (account ? networkExplorer(entry.network, "address", account) : undefined)
  );
}

const viewTo = (
  to: AomiRuleTo,
  catalog: AomiRulesCatalog | null | undefined,
): PolicyTo =>
  to.kind === "any_protocol"
    ? { kind: "any_app" }
    : to.kind === "protocol"
      ? { kind: "app", id: to.id, label: toLabel(to, catalog) }
      : { kind: "address", address: to.address };

export const wireTo = (to: PolicyTo): AomiRuleTo =>
  to.kind === "any_app"
    ? { kind: "any_protocol" }
    : to.kind === "app"
      ? { kind: "protocol", id: to.id }
      : { kind: "address", address: to.address };

/**
 * Rules that differ only by chain share a row. One waiting to be signed
 * keeps its own: each rule deploys with its own signature.
 */
export function policyRows(
  rules: Pick<AomiWalletRules, "rules" | "enforcement">,
  catalog?: AomiRulesCatalog | null,
  now = Date.now(),
): Policy[] {
  const rows = new Map<string, Policy>();
  for (const rule of rules.rules.rules) {
    const id = rule.id ?? ruleKey(rule);
    const token = catalog?.tokens.find((entry) => entry.asset === rule.asset);
    const symbol = rule.symbol ?? token?.symbol;
    const decimals =
      typeof rule.decimals === "number" ? rule.decimals : token?.decimals;
    const known = symbol !== undefined && typeof decimals === "number";
    const ended =
      typeof rule.active_until === "number" && rule.active_until * 1000 <= now;
    const held = ruleEnforcement(
      rule,
      rules.enforcement,
      known ? { symbol, decimals } : undefined,
    );
    const enforcement: PolicyEnforcement =
      ended && held.deploy ? { name: null } : held;
    const chain: PolicyChain = {
      label: assetChain(rule.asset, catalog ?? undefined),
      network: assetNetwork(rule.asset),
    };
    const policy: Policy = {
      id,
      ruleIds: [id],
      symbol: known ? symbol : shortAsset(rule.asset),
      amount: known
        ? policyAmount(fromBaseUnits(rule.amount, decimals))
        : rule.amount,
      blocked: /^0+$/.test(rule.amount),
      to: viewTo(rule.to, catalog),
      chains: [chain],
      activeFrom:
        typeof rule.active_from === "number"
          ? localDay(rule.active_from)
          : null,
      activeUntil:
        typeof rule.active_until === "number"
          ? localDay(rule.active_until)
          : null,
      ended,
      enforcement,
    };
    const key = JSON.stringify([
      policy.symbol,
      policy.amount,
      policy.to.kind === "app"
        ? policy.to.id
        : policy.to.kind === "address"
          ? policy.to.address
          : policy.to.kind,
      policy.activeFrom,
      policy.activeUntil,
      ended,
      // Merge only when all shown enforcement matches; `deploy` is per rule.
      enforcement.name,
      enforcement.deploy ?? null,
      enforcement.href ?? null,
      enforcement.warning?.label ?? null,
      enforcement.note ?? null,
      enforcement.left ?? null,
      enforcement.chainEnd ?? null,
    ]);
    const row = rows.get(key);
    if (row)
      rows.set(key, {
        ...row,
        ruleIds: [...row.ruleIds, id],
        chains: [...row.chains, chain],
      });
    else rows.set(key, policy);
  }
  return [...rows.values()];
}

/** A `<asset>@<to>` key in parts; `to` is null when the key does not say. */
function ruleKeyParts(id: string): { asset: string; to: AomiRuleTo | null } {
  const at = id.lastIndexOf("@");
  if (at < 0) return { asset: id, to: null };
  const asset = id.slice(0, at);
  const where = id.slice(at + 1);
  const colon = where.indexOf(":");
  const kind = colon < 0 ? where : where.slice(0, colon);
  const value = colon < 0 ? "" : where.slice(colon + 1);
  if (where === "any" || where === "any_protocol")
    return { asset, to: { kind: "any_protocol" } };
  if (kind === "protocol" && value)
    return { asset, to: { kind: "protocol", id: value } };
  if (kind === "address" && value)
    return { asset, to: { kind: "address", address: value } };
  return { asset, to: null };
}

/**
 * Removed policies still on chain: entries not `off` whose rule is no longer
 * the wallet's. One row each, never counted or merged; only the old id says
 * what the rule was.
 */
export function removedPolicies(
  rules: Pick<AomiWalletRules, "rules" | "enforcement">,
  catalog?: AomiRulesCatalog | null,
): RemovedPolicy[] {
  const current = new Set(
    rules.rules.rules.map((rule) => rule.id ?? ruleKey(rule)),
  );
  return rules.enforcement.flatMap((entry) => {
    if (current.has(entry.rule) || entry.state === "off") return [];
    const { asset, to } = ruleKeyParts(entry.rule);
    const token = catalog?.tokens.find(
      (candidate) => candidate.asset.toLowerCase() === asset.toLowerCase(),
    );
    const symbol = token?.symbol ?? shortAsset(asset);
    return [
      {
        key: enforcementKey(entry),
        id: entry.rule,
        symbol,
        to: to ? viewTo(to, catalog) : null,
        chain: {
          label: assetChain(
            asset.includes("/") ? asset : `${entry.network}/`,
            catalog ?? undefined,
          ),
          network: entry.network,
        },
        enforcement: {
          name: entry.name,
          href: deploymentLink(entry),
          ...(entry.ready ? { deploy: enforcementKey(entry) } : {}),
          ...(sendsRevocation(entry) ? { send: true } : {}),
          ...(entry.state === "unverified"
            ? { warning: { label: WARNINGS.unverified! } }
            : {}),
          ...(entry.note ? { note: entry.note } : {}),
          ...(entry.left !== null
            ? { left: leftLine(entry.left, symbol, token?.decimals) }
            : {}),
        },
      },
    ];
  });
}

export function removalSummary(policy: RemovedPolicy) {
  return `Take ${policy.symbol}${policy.to ? ` ${policyToPhrase(policy.to)}` : ""} (${policy.chain.label}) off the chain`;
}

/** How many of a wallet's policies have not ended, as the tab lists them. */
export const activePolicyCount = (
  rules: Pick<AomiWalletRules, "rules" | "enforcement">,
  now = Date.now(),
) => policyRows(rules, null, now).filter((policy) => !policy.ended).length;

export function policyCatalog(catalog: AomiRulesCatalog): PolicyCatalog {
  const tokens = new Map<string, PolicyTokenChain[]>();
  for (const token of catalog.tokens) {
    const network = assetNetwork(token.asset);
    const part = token.asset.slice(token.asset.indexOf("/") + 1);
    const address = part.includes(":")
      ? part.slice(part.indexOf(":") + 1)
      : undefined;
    tokens.set(token.symbol, [
      ...(tokens.get(token.symbol) ?? []),
      {
        chain: { label: assetChain(token.asset, catalog), network },
        asset: token.asset,
        decimals: token.decimals,
        ...(address
          ? { address, explorer: networkExplorer(network, "token", address) }
          : {}),
      },
    ]);
  }
  return {
    tokens: [...tokens].map(([symbol, chains]) => ({ symbol, chains })),
    apps: catalog.apps,
  };
}

/**
 * Who could hold a new policy per network. An older backend that lists no
 * providers falls back to the wallet's own entries.
 */
export function policyProviders(
  rules: Pick<AomiWalletRules, "providers" | "enforcement">,
): PolicyProviders {
  const listed = rules.providers.length > 0;
  const found: Record<string, PolicyProviders[string]> = {};
  for (const entry of listed ? rules.providers : rules.enforcement) {
    found[entry.network] ??= {
      name: entry.name,
      ...("holds" in entry ? { holds: entry.holds } : {}),
    };
  }
  return found;
}

/** One rule per picked chain; null when the amount does not fit the token. */
export function draftRules(draft: PolicyDraft): AomiRule[] | null {
  const rules: AomiRule[] = [];
  for (const entry of draft.chains) {
    const amount = toBaseUnits(draft.amount, entry.decimals);
    if (amount === null) return null;
    rules.push({
      asset: entry.asset,
      amount,
      to: wireTo(draft.to),
      ...(draft.activeUntil
        ? { active_until: endOfLocalDay(draft.activeUntil) }
        : {}),
    });
  }
  return rules;
}

export const authorityOf = (admin: AomiRulesAdmin): PolicyAuthority =>
  admin.kind === "wallet"
    ? {
        kind: "wallet",
        family: admin.family === "evm" ? "EVM" : "SVM",
        address: admin.address,
      }
    : { kind: "aomi" };

export const adminOf = (authority: PolicyAuthority): AomiRulesAdmin =>
  authority.kind === "wallet"
    ? {
        kind: "wallet",
        family: authority.family === "EVM" ? "evm" : "svm",
        address: authority.address,
      }
    : { kind: "aomi_managed" };

export const sameAuthority = (left: PolicyAuthority, right: PolicyAuthority) =>
  left.kind === "wallet" && right.kind === "wallet"
    ? left.family === right.family &&
      (left.family === "EVM"
        ? left.address.toLowerCase() === right.address.toLowerCase()
        : left.address === right.address)
    : left.kind === right.kind;
