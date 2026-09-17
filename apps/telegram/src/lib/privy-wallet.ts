"use client";

import type { User, WalletWithMetadata } from "@privy-io/react-auth";

/** The embedded EVM wallet as the Privy *user* records it.
 *
 *  This is deliberately not `useWallets()`. That hook answers "is a wallet
 *  connected in this browser", and its `ready` additionally waits on Privy's
 *  wallet-proxy iframe, on the external connectors, and — once the account
 *  already owns an embedded wallet — on that wallet being actively connected.
 *  Inside Telegram's in-app webview, third-party iframe storage is restricted
 *  and that connection routinely never lands, so `ready` stays false forever on
 *  an account whose wallet exists and works.
 *
 *  Nothing this app does needs a *connected* wallet. The exchange sends an
 *  identity token and the portal attests the hosted wallet server-side; the
 *  permit is signed through Privy's own `signTypedData`, which takes an
 *  address; and delegation is granted through `addSessionSigners`, which takes
 *  an address too. `linkedAccounts` reports existence — plus the wallet id and
 *  the delegation flag — without any of that iframe machinery.
 */
export type EmbeddedWallet = {
  address: string;
  /** Privy's server wallet id. Null until the wallet is delegated. */
  id: string | null;
  /** Whether the wallet API may already transact on the user's behalf. */
  delegated: boolean;
};

function isEmbeddedEvmWallet(
  account: User["linkedAccounts"][number],
): account is WalletWithMetadata {
  return (
    account.type === "wallet" &&
    account.chainType === "ethereum" &&
    account.imported !== true &&
    (account.walletClientType === "privy" ||
      account.walletClientType === "privy-v2")
  );
}

export function embeddedWallet(user: User | null): EmbeddedWallet | null {
  const account = user?.linkedAccounts.find(isEmbeddedEvmWallet);
  if (!account) return null;
  return {
    address: account.address,
    id: account.id ?? null,
    delegated: account.delegated === true,
  };
}
