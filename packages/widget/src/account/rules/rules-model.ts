import {
  AomiApiError,
  SUPPORTED_CHAINS,
  shortAddress,
  type AomiRuleAssetCap,
  type AomiRulesAdmin,
  type AomiRulesAdminWallet,
  type AomiRulesCatalog,
  type AomiWalletRule,
} from "@aomi-labs/client";

/**
 * A human amount ("0.5") as base units ("500000000"), by string math only:
 * amounts can exceed 2^53. Null when it is not a plain decimal number or has
 * more fraction digits than the token.
 */
export function toBaseUnits(human: string, decimals: number): string | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(human.trim().replace(/,/g, ""));
  if (!match) return null;
  const whole = match[1] ?? "";
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

/** The token part of an asset id, shortened: an address or a mint. */
export function shortAsset(asset: string): string {
  const token = asset.slice(asset.indexOf("/") + 1);
  const address = token.includes(":")
    ? token.slice(token.indexOf(":") + 1)
    : token;
  return address === "native" ? asset : shortAddress(address);
}

/** The chain an asset id lives on, by name. */
export function assetChain(asset: string, catalog?: AomiRulesCatalog): string {
  const known = catalog?.tokens.find((token) => token.asset === asset)?.chain;
  if (known) return known;
  const [namespace, reference] = asset.split("/")[0]!.split(":");
  if (namespace === "solana") return "Solana";
  const chain = SUPPORTED_CHAINS.find((item) => String(item.id) === reference);
  return chain?.name ?? `Chain ${reference ?? ""}`.trim();
}

type Displayed = Pick<AomiRuleAssetCap, "asset" | "symbol" | "decimals">;

/** `200 USDC`; an unknown token shows its raw amount and short address. */
export function assetAmount(amount: string, asset: Displayed): string {
  return asset.symbol && typeof asset.decimals === "number"
    ? `${fromBaseUnits(amount, asset.decimals)} ${asset.symbol}`
    : `${amount} ${shortAsset(asset.asset)}`;
}

/** How much of a limit is used, 0 to 100. */
export function usedPercent(used: string, cap: string): number {
  const zero = BigInt(0);
  const hundred = BigInt(100);
  const limit = BigInt(cap);
  if (limit <= zero) return BigInt(used) > zero ? 100 : 0;
  const percent = (BigInt(used) * hundred) / limit;
  return percent > hundred ? 100 : Number(percent);
}

/** `23 h`, `40 min`, or null once the time has passed. */
export function timeUntil(
  unixSeconds: number,
  now = Date.now(),
): string | null {
  const seconds = unixSeconds - Math.floor(now / 1000);
  if (seconds <= 0) return null;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.max(1, Math.floor(seconds / 60))} min`;
}

/** `Nov 21`, with the year when it is not this one. Dates are UTC, like the limits. */
export function untilDate(unixSeconds: number, now = Date.now()): string {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(date.getUTCFullYear() === new Date(now).getUTCFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/**
 * A `<input type="date">` value for a UTC day, and back. "Until Nov 21"
 * includes the day: the wallet stops at its last second.
 */
export const dateInputValue = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10);
export function dateInputSeconds(value: string): number | null {
  const ms = Date.parse(`${value}T23:59:59Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** The rule of one kind, when the list has it. */
export function ruleOf<Kind extends AomiWalletRule["kind"]>(
  rules: readonly AomiWalletRule[],
  kind: Kind,
): Extract<AomiWalletRule, { kind: Kind }> | undefined {
  return rules.find(
    (rule): rule is Extract<AomiWalletRule, { kind: Kind }> =>
      rule.kind === kind,
  );
}

/** The list with every rule of `kind` replaced by `next` (or dropped). */
export function withRule(
  rules: readonly AomiWalletRule[],
  kind: AomiWalletRule["kind"],
  next?: AomiWalletRule,
): AomiWalletRule[] {
  const rest = rules.filter((rule) => rule.kind !== kind);
  return next ? [...rest, next] : rest;
}

/** The list with one asset's limit set to `amount`, or removed when null. */
export function withCap(
  rules: readonly AomiWalletRule[],
  asset: string,
  amount: string | null,
): AomiWalletRule[] {
  const has = rules.some(
    (rule) => rule.kind === "asset_cap" && rule.asset === asset,
  );
  if (amount === null)
    return rules.filter(
      (rule) => !(rule.kind === "asset_cap" && rule.asset === asset),
    );
  if (!has)
    return [...rules, { kind: "asset_cap", asset, amount, window: "day" }];
  return rules.map((rule) =>
    rule.kind === "asset_cap" && rule.asset === asset
      ? { ...rule, amount }
      : rule,
  );
}

export const sameWallet = (
  wallet: Pick<AomiRulesAdminWallet, "family" | "address">,
  family: string,
  address: string | undefined,
) =>
  Boolean(address) &&
  wallet.family === family &&
  (family === "evm"
    ? wallet.address.toLowerCase() === address!.toLowerCase()
    : wallet.address === address);

export const sameAdmin = (left: AomiRulesAdmin, right: AomiRulesAdmin) =>
  left.kind === "wallet" && right.kind === "wallet"
    ? sameWallet(left, right.family, right.address)
    : left.kind === right.kind;

/** A failed rules request's code, or undefined for anything else. */
export const rulesErrorCode = (error: unknown): string | undefined =>
  error instanceof AomiApiError ? error.code : undefined;

const FAILURES: Record<string, string> = {
  rules_app_unknown: "That app isn't available.",
  rules_asset_invalid: "That token isn't supported.",
  rules_amount_invalid: "Enter a valid amount.",
  rules_duplicate: "That rule is already there.",
  rules_admin_wallet_not_linked: "Link that wallet to your account first.",
  rules_connection_invalid: "That connection can't use this wallet.",
  agent_wallet_not_found: "This wallet no longer exists.",
  rules_change_not_found: "This change doesn't exist.",
  rules_change_not_open: "This change was already decided.",
  rules_changed: "The rules changed. Review them again.",
  rules_change_pending:
    "A change is already waiting. Approve or decline it first.",
  rules_signature_required: "This change needs a wallet signature.",
  rules_signature_invalid: "That signature doesn't match the admin wallet.",
  login_stale: "For a rule change, sign in again.",
  scope_denied: "Sign in on Aomi to change rules.",
  owner_session_required: "Sign in on Aomi to change rules.",
  guest_account: "Sign in on Aomi to change rules.",
};

/** What a refused rules request means for the person on the page. */
export function rulesFailure(error: unknown, fallback: string): string {
  const code = rulesErrorCode(error);
  return (code && FAILURES[code]) ?? fallback;
}
