import {
  AomiApiError,
  SUPPORTED_CHAINS,
  shortAddress,
  ruleKey,
  type AomiRule,
  type AomiRuleTo,
  type AomiRulesAdminWallet,
  type AomiRulesCatalog,
} from "@aomi-labs/client";

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

/** The CAIP-2 chain of an asset id: `eip155:8453`, `solana:mainnet-beta`. */
export const assetNetwork = (asset: string) => asset.split("/")[0]!;

/** `Jupiter`, `Any protocol`, or `Send to 0x12ab…cdef`. */
export function toLabel(to: AomiRuleTo, catalog?: AomiRulesCatalog | null) {
  if (to.kind === "any_protocol") return "Any protocol";
  if (to.kind === "address") return `Send to ${shortAddress(to.address)}`;
  return (
    catalog?.apps.find((app) => app.id === to.id)?.label ??
    `${to.id.charAt(0).toUpperCase()}${to.id.slice(1)}`
  );
}

/** An address as the chain of `asset` writes one. */
export function validAddress(asset: string, address: string): boolean {
  return assetNetwork(asset).startsWith("eip155:")
    ? /^0x[0-9a-fA-F]{40}$/.test(address)
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

/**
 * The rules with `rule` added, or put in place of the one with its asset
 * and destination.
 */
export function withRule(
  rules: readonly AomiRule[],
  rule: AomiRule,
): AomiRule[] {
  const key = ruleKey(rule);
  return rules.some((held) => ruleKey(held) === key)
    ? rules.map((held) => (ruleKey(held) === key ? rule : held))
    : [...rules, rule];
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

/** A failed rules request's code, or undefined for anything else. */
export const rulesErrorCode = (error: unknown): string | undefined =>
  error instanceof AomiApiError ? error.code : undefined;

const FAILURES: Record<string, string> = {
  rules_app_unknown: "That app isn't available on this chain.",
  rules_asset_invalid: "That token isn't supported.",
  rules_address_invalid: "That address isn't one for this chain.",
  rules_duplicate: "That policy is already there.",
  rules_period_invalid: "Pick an end date in the future.",
  rules_change_rate_limited:
    "Too many changes were filed in the last hour. Try again later.",
  rules_not_enforceable: "These policies can't go on chain yet.",
  rules_admin_wallet_not_linked: "Link that wallet to your account first.",
  rules_connection_invalid: "That connection can't use this wallet.",
  agent_wallet_not_found: "This wallet no longer exists.",
  rules_change_not_found: "This change doesn't exist.",
  rules_change_not_open: "This change was already decided.",
  rules_changed: "The policies changed. Review them again.",
  rules_change_pending:
    "A change is already waiting. Approve or decline it first.",
  rules_signature_required: "This change needs a wallet signature.",
  rules_signature_invalid: "That signature doesn't match the admin wallet.",
  login_stale: "For a policy change, sign in again.",
  scope_denied: "Sign in on Aomi to change policies.",
  owner_session_required: "Sign in on Aomi to change policies.",
  guest_account: "Sign in on Aomi to change policies.",
};

/**
 * What a refused rules request means for the person on the page, who knows
 * rules as policies.
 */
export function rulesFailure(error: unknown, fallback: string): string {
  const code = rulesErrorCode(error);
  return (code && FAILURES[code]) ?? fallback;
}
