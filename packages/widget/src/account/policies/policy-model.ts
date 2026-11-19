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

/**
 * A wallet's rules as the Policies tab shows them. "Policy" is the on-screen
 * word; the wire calls them rules. One row may stand for the same policy on
 * several chains: each chain keeps its own total.
 */
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
  /**
   * Where to see the provider's side of it on the chain's explorer: the
   * deployment's transaction when it is known, else the owner's account.
   */
  href?: string;
  /** Set when the owner can sign it onto the chain: the step's key. */
  deploy?: string;
  /**
   * Set on a removed policy whose revocation the owner already signed: the
   * step left is to send it from their own wallet, not to sign.
   */
  send?: boolean;
  /** The chain holds something else, or could not be read. */
  warning?: { label: string };
  /** Why the provider cannot hold it, or what is wrong. */
  note?: string;
  /** What the chain will still let through, as shown: `0.4 SOL left`. */
  left?: string;
  /**
   * The local day the chain stops signing, `YYYY-MM-DD`, when that is more
   * than a day from the policy's own end (a slack the chain adds).
   */
  chainEnd?: string;
  /** What of the policy the chain holds, when it is not all of it. */
  scope?: string;
};

export type Policy = {
  id: string;
  /** The rules this row stands for, one per chain. */
  ruleIds: readonly string[];
  symbol: string;
  /** The total, in the token's own units, as shown: `1,000`. */
  amount: string;
  /** A total of zero: the token is blocked there. */
  blocked: boolean;
  to: PolicyTo;
  /** The chains it applies on; each chain has its own total. */
  chains: readonly PolicyChain[];
  /** The local day it took effect, `YYYY-MM-DD`. Set by the system. */
  activeFrom: string | null;
  /** The local day it ends, `YYYY-MM-DD`; null is "Always on". */
  activeUntil: string | null;
  /** Its end has passed. */
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
 * A policy the owner removed whose deployment the chain still holds: the
 * rule is gone, its provider's entry is not. It has no total, no period and
 * no remove button; it is one step, taking what the chain holds off.
 */
export type RemovedPolicy = {
  /** The key of its provider's step: the row's own, one per entry. */
  key: string;
  /** The id the rule had. */
  id: string;
  symbol: string;
  /** Where it could send, as far as the id says. */
  to: PolicyTo | null;
  chain: PolicyChain;
  /** Who holds it, what is left, the note, and the step (`deploy`). */
  enforcement: PolicyEnforcement;
};

export type WalletPolicies = {
  id: string;
  name: string;
  linkedOnly: boolean;
  onlyListed: boolean;
  policies: readonly Policy[];
  /** Removed policies the chain still holds, after the live ones. */
  removed?: readonly RemovedPolicy[];
  authority: PolicyAuthority;
  /** The signed-in wallets that may be the authority. */
  authorityWallets: readonly PolicyAuthorityWallet[];
  /** The agent stopped the wallet for today. */
  stopped?: boolean;
};

/** A token on one chain; a native token has no contract. */
export type PolicyTokenChain = {
  chain: PolicyChain;
  /** The asset id a rule names. */
  asset: string;
  decimals: number;
  address?: string;
  /** The contract's page on the chain's explorer. */
  explorer?: string;
};

/** What the picker can offer: tokens with their chains, and apps per chain. */
export type PolicyCatalog = {
  tokens: readonly { symbol: string; chains: readonly PolicyTokenChain[] }[];
  /** `chains` are the networks the app runs on. */
  apps: readonly { id: string; label: string; chains: readonly string[] }[];
};

/** Who can hold a new policy on a network; absent means Aomi only. */
export type PolicyProviders = Readonly<
  Record<
    string,
    {
      name: string;
      /**
       * What the provider holds of a rule at least (`AomiRulesProvider.holds`).
       * `total_and_period` leaves the destination to Aomi. Unknown from a
       * backend that does not report its providers.
       */
      holds?: AomiRulesProvider["holds"];
      /** Shown on an app policy when the chain holds only part of it. */
      appScope?: string;
    }
  >
>;

/** What the picker hands over: one policy on each picked chain. */
export type PolicyDraft = {
  symbol: string;
  /** The total as typed, in the token's own units. */
  amount: string;
  chains: readonly PolicyTokenChain[];
  to: PolicyTo;
  /** The last local day it is active, `YYYY-MM-DD`; null is always on. */
  activeUntil: string | null;
};

const pad = (value: number) => String(value).padStart(2, "0");
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Unix seconds as the local day they fall on, `YYYY-MM-DD`. */
export const localDay = (seconds: number) => dayOf(new Date(seconds * 1000));

/** The local day `days` after today. */
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

/** The row's period line. */
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

/** The destination as the end of the sentence. */
export function policyToPhrase(to: PolicyTo) {
  if (to.kind === "any_app") return "on any protocol";
  if (to.kind === "app") return `on ${to.label}`;
  return `to ${short(to.address)}`;
}

/**
 * What signing a policy's grant asks of the owner, in a line: the total, the
 * token, where it may go, the chain and the end. It comes from the policy, not
 * from the bytes: the wallet shows the signed data itself.
 */
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

/** A network's explorer page for an address or a token, if it has one. */
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
 * What the backend's entry for a removed rule starts with once the owner's
 * signed revocation is stored and is theirs to send ("Your revocation is
 * signed. Send it from your wallet to take the grant off chain, ..."). The
 * entry carries no field for which step is next, so this sentence is how the
 * row knows to say "Send revocation" before it asks the backend; what the
 * wallet then does is decided by the action `prepare` answers, never by this.
 */
export const SEND_NOTE_PREFIX = "Your revocation is signed. Send it";

/** A removed rule's entry waits for the owner to send their signed revocation. */
export const sendsRevocation = (
  entry: Pick<AomiRulesEnforcement, "ready" | "note">,
) => entry.ready && Boolean(entry.note?.startsWith(SEND_NOTE_PREFIX));

/**
 * The key of one provider's step for one rule on one network: what "Sign to
 * deploy" runs. The backend signs per rule, so every rule has its own.
 */
export const enforcementKey = (
  entry: Pick<AomiRulesEnforcement, "provider" | "network" | "rule">,
) => `${entry.provider}:${entry.network}:${entry.rule}`;

const DAY = 86_400;

/** The token a rule's amounts are shown in: its symbol, and its decimals if known. */
type PolicyUnits = { symbol: string; decimals?: number | null };

/** What the chain will still let through, as shown: `0.4 SOL left`. */
const leftLine = (left: string, symbol: string, decimals?: number | null) =>
  `${
    typeof decimals === "number"
      ? policyAmount(fromBaseUnits(left, decimals))
      : left
  } ${symbol} left`;

/**
 * A rule's "Onchain Enforcement" line, from its own entry: a rule is one
 * deployment, so the entry says who holds it, whether it is on chain, what
 * is left of its total and when the chain ends it. A rule no provider can
 * hold has no entry, and an entry that is off and not ready is a provider
 * declining it: either way only Aomi enforces it.
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

/**
 * The deployment's transaction when the wallet reported one, else the
 * account that holds what the rule spends (the owner's account for a signed
 * grant) on the chain's explorer.
 */
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

/** A picked destination as a rule writes it. */
export const wireTo = (to: PolicyTo): AomiRuleTo =>
  to.kind === "any_app"
    ? { kind: "any_protocol" }
    : to.kind === "app"
      ? { kind: "protocol", id: to.id }
      : { kind: "address", address: to.address };

/**
 * A wallet's rules as rows. Rules that differ only by chain share a row: the
 * same token, total, destination, period and enforcement state. A policy
 * waiting to be signed onto a chain keeps its own row, because the backend
 * deploys each rule on its own and each is its own signature.
 */
export function policyRows(
  rules: Pick<AomiWalletRules, "rules" | "enforcement">,
  catalog?: AomiRulesCatalog | null,
  now = Date.now(),
): Policy[] {
  const rows = new Map<string, Policy>();
  for (const rule of rules.rules.rules) {
    const id = rule.id ?? ruleKey(rule);
    // A token neither the rule nor the catalog names is shown in raw units.
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
    // Nothing is left to sign for a policy that ended.
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
      // Rules merge only while everything shown about their enforcement is
      // the same: its state, its link, its end. A row waiting for a signature
      // never merges, because its step is the rule's own.
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

/** A rule's key `<asset>@<to>` in parts; `to` is null when the key does not say. */
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
 * The policies the owner removed that a provider still holds on chain. The
 * backend keeps their entries under the old rule id, ready to be taken off,
 * so they are read from the entries: an entry whose rule is not among the
 * wallet's rules and that is not `off` (not on chain, or a provider that
 * declined). Each entry is its own row, and none is a live policy: they are
 * not counted and never merge. Only the old id says what the rule was, so a
 * token or app the catalog does not know shows as the id writes it.
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

/** What signing a removed policy's step asks of the owner, in a line. */
export function removalSummary(policy: RemovedPolicy) {
  return `Take ${policy.symbol}${policy.to ? ` ${policyToPhrase(policy.to)}` : ""} (${policy.chain.label}) off the chain`;
}

/** How many of a wallet's policies have not ended, as the tab lists them. */
export const activePolicyCount = (
  rules: Pick<AomiWalletRules, "rules" | "enforcement">,
  now = Date.now(),
) => policyRows(rules, null, now).filter((policy) => !policy.ended).length;

/** The backend's catalog as the picker reads it: one token, its chains. */
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
 * Who could hold a new policy on each network: the providers the backend
 * lists, which hold for a wallet with no rules too. A backend that does not
 * list them is read from the wallet's own entries, which exist per rule.
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

/**
 * The rules a draft adds, one per picked chain; null when the amount is not
 * one the token can hold. The end is the end of the chosen local day.
 */
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
