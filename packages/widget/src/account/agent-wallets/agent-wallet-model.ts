import {
  CHAINS_BY_ID,
  SUPPORTED_CHAINS,
  parseWalletRef,
  type AomiAgentWallet,
  type AomiAgentWalletBalances,
} from "@aomi-labs/client";
import type { WalletFamily } from "@/wallet/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";

/** How many agent wallets the Account tab shows before "Show all". */
export const SHOWN_AGENT_WALLETS = 3;

export const familyName = (family: WalletFamily) =>
  family === "evm" ? "EVM" : "SVM";

/** The wallet kit's rows for this agent wallet's addresses, EVM first. */
export function walletRows(
  wallet: AomiAgentWallet,
  rows: readonly WalletRow[],
): WalletRow[] {
  return wallet.addresses.flatMap((address) => {
    const id = parseWalletRef(address.wallet_id);
    const row = rows.find(
      (candidate) =>
        candidate.kind === "agent" && candidate.linkedWalletId === id,
    );
    return row ? [row] : [];
  });
}

/**
 * Unarchived wallets, most recently used first (the server's order), cut to
 * `limit` with the active one always kept in.
 */
export function shownWallets(
  wallets: readonly AomiAgentWallet[],
  isActive: (wallet: AomiAgentWallet) => boolean,
  limit = SHOWN_AGENT_WALLETS,
): AomiAgentWallet[] {
  const shown = wallets.slice(0, limit);
  const active = wallets.find(isActive);
  if (!active || shown.includes(active)) return shown;
  return [...shown.slice(0, limit - 1), active];
}

/** The mainnets an EVM agent address works on, from the SDK's chain list. */
export const EVM_NETWORKS: readonly string[] = SUPPORTED_CHAINS.filter(
  (chain) => !CHAINS_BY_ID[chain.id]?.testnet && chain.id !== 31337,
).map((chain) => chain.name);

/** Any asset with a nonzero amount on a network that could be read. */
export const holdsFunds = (balances: readonly AomiAgentWalletBalances[]) =>
  balances.some((balance) =>
    balance.networks.some((network) =>
      network.assets.some((asset) => Number(asset.amount) > 0),
    ),
  );
