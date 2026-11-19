import type { AomiRulesEnforcement } from "@aomi-labs/client";
import {
  assetChain,
  fromBaseUnits,
  toBaseUnits,
} from "@/account/rules/rules-model";
import {
  networkExplorer,
  policyAmount,
  type PolicyCatalog,
  type PolicyChain,
} from "./policy-model";
import { WITHDRAW_CHAINS, type WithdrawAsset } from "./vault-withdraw";

/** The provider whose entries carry a vault: the owner's MetaMask account. */
export const VAULT_PROVIDER = "metamask";

/** One vault of the owner's on one chain: what a Withdraw row stands for. */
export type Vault = {
  /** `<chain id>:<vault address, lower case>`: one row per key. */
  key: string;
  /** The vault's address. */
  address: string;
  chainId: number;
  chain: PolicyChain;
  /** The owner's EVM account: it signs the withdrawal and receives it. */
  owner: string;
  /** The vault's page on the chain's explorer. */
  explorer?: string;
};

/** A token a vault may hold: its symbol, decimals and how it is moved. */
export type VaultToken = {
  symbol: string;
  decimals: number;
  asset: WithdrawAsset;
};

export type VaultHolding = { token: VaultToken; raw: bigint };

const PLAIN_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = BigInt(0);

/**
 * The vaults a wallet's enforcement entries name, one per distinct vault and
 * chain, in the order the entries come. Only a MetaMask entry on a chain a
 * withdrawal is built for counts, live or removed: the vault outlives the
 * rule. An entry with no vault yet, no EVM owner, or whose vault is the
 * owner's own account (nothing to withdraw from) names none. Addresses are
 * kept in lower case.
 */
export function vaultsOf(entries: readonly AomiRulesEnforcement[]): Vault[] {
  const found = new Map<string, Vault>();
  for (const entry of entries) {
    if (entry.provider !== VAULT_PROVIDER || entry.signer.family !== "evm")
      continue;
    const chainId = Number(/^eip155:(\d+)$/.exec(entry.network)?.[1]);
    const { account, signer } = entry;
    if (
      !WITHDRAW_CHAINS.includes(chainId) ||
      !account ||
      !signer.address ||
      !PLAIN_ADDRESS.test(account) ||
      !PLAIN_ADDRESS.test(signer.address) ||
      account.toLowerCase() === signer.address.toLowerCase()
    )
      continue;
    const key = `${chainId}:${account.toLowerCase()}`;
    if (found.has(key)) continue;
    // Lower case: a mixed-case address must carry a valid checksum, and the
    // backend may write the owner either way.
    found.set(key, {
      key,
      address: account.toLowerCase(),
      chainId,
      chain: {
        label: assetChain(`${entry.network}/`),
        network: entry.network,
      },
      owner: signer.address.toLowerCase(),
      explorer: networkExplorer(entry.network, "address", account),
    });
  }
  return [...found.values()];
}

/**
 * What a vault on `network` may hold: the catalog's ERC-20 tokens on that
 * chain, then the chain's native coin (ETH on every chain a withdrawal is
 * built for, whether or not the catalog lists it).
 */
export function vaultTokens(
  catalog: PolicyCatalog | null,
  network: string,
): VaultToken[] {
  const tokens: VaultToken[] = [];
  const seen = new Set<string>();
  for (const { symbol, chains } of catalog?.tokens ?? []) {
    for (const entry of chains) {
      const address = entry.address?.toLowerCase();
      if (entry.chain.network !== network || !address) continue;
      if (!PLAIN_ADDRESS.test(address) || seen.has(address)) continue;
      seen.add(address);
      tokens.push({
        symbol,
        decimals: entry.decimals,
        asset: { erc20: address },
      });
    }
  }
  return [...tokens, { symbol: "ETH", decimals: 18, asset: { native: true } }];
}

/** A token's identity within one vault. */
export const tokenKey = (token: VaultToken) =>
  "erc20" in token.asset ? `erc20:${token.asset.erc20}` : "native";

/** The holdings that are not zero, in the order read. */
export const nonzero = (holdings: readonly VaultHolding[]) =>
  holdings.filter((held) => held.raw > ZERO);

/** Both holdings lists say the same of every token. */
export const sameHoldings = (
  left: readonly VaultHolding[],
  right: readonly VaultHolding[],
) =>
  left.length === right.length &&
  left.every(
    (held, index) =>
      tokenKey(held.token) === tokenKey(right[index]!.token) &&
      held.raw === right[index]!.raw,
  );

/** The exact amount, as `Max` types it: no rounding, so it parses back whole. */
export const exactAmount = (raw: bigint, decimals: number) =>
  fromBaseUnits(raw.toString(), decimals);

/**
 * An amount as the row shows it: at least two decimals, at most six, grouped
 * thousands (`95.00`, `0.98`, `1,250.5`). A dust amount reads `<0.000001`.
 */
export function shownAmount(raw: bigint, decimals: number) {
  const [whole = "0", fraction = ""] = exactAmount(raw, decimals).split(".");
  if (decimals === 0) return policyAmount(whole);
  const cut = fraction.slice(0, 6).replace(/0+$/, "");
  if (raw > ZERO && whole === "0" && cut === "") return "<0.000001";
  return `${policyAmount(whole)}.${cut.padEnd(2, "0")}`;
}

/** `USDC 95.00 · ETH 0.98`: what the vault holds, or null when nothing. */
export function holdingsLine(holdings: readonly VaultHolding[]) {
  const held = nonzero(holdings);
  return held.length
    ? held
        .map(
          ({ token, raw }) =>
            `${token.symbol} ${shownAmount(raw, token.decimals)}`,
        )
        .join(" · ")
    : null;
}

/**
 * What the owner typed as an amount to withdraw, in the token's base units, or
 * the plain reason it cannot be sent. Nothing above what the vault holds, and
 * nothing that is not a positive number the token can hold.
 */
export function parseWithdrawAmount(
  text: string,
  token: VaultToken,
  balance: bigint,
): { amount: bigint } | { error: string } {
  const base = toBaseUnits(text, token.decimals);
  if (base === null) return { error: "Enter an amount, like 12.5." };
  const amount = BigInt(base);
  if (amount === ZERO) return { error: "The amount must be above 0." };
  if (amount > balance)
    return { error: `That is more than the vault holds of ${token.symbol}.` };
  return { amount };
}
