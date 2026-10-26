"use client";

import type { SafeSvmWalletState } from "@/wallet/runtime/svm/wallet-runtime";
import { formatWalletAddress } from "@/wallet/identity";
import type { PrivySolanaWallet } from "./privy-auth";

export function buildPrivySvmWalletState({
  wallet,
  wallets,
  setActiveAddress,
  signWithPrivy,
}: {
  wallet: PrivySolanaWallet | undefined;
  wallets: readonly PrivySolanaWallet[];
  setActiveAddress: (address: string) => void;
  /**
   * Signs through Privy's Solana hook, which shows Privy's confirmation like
   * its EVM signing does; the wallet's own `signTransaction` signs silently.
   */
  signWithPrivy?: (tx: unknown, address: string) => Promise<unknown>;
}): SafeSvmWalletState {
  return {
    publicKey: wallet?.address,
    connected: Boolean(wallet?.address),
    connecting: false,
    disconnecting: false,
    walletName: wallet ? "Privy Solana" : undefined,
    providerId: wallet ? "privy" : undefined,
    transport: wallet ? "embedded" : undefined,
    wallets: wallets.map((entry) => ({
      adapter: {
        name: `Privy Solana ${formatWalletAddress(entry.address) ?? ""}`.trim(),
        readyState: "Installed" as const,
      },
      readyState: "Installed" as const,
    })),
    select: (walletName) => {
      if (!walletName) return;
      const target = wallets.find((entry) =>
        walletName
          .toString()
          .includes(formatWalletAddress(entry.address) ?? ""),
      );
      if (target?.address) setActiveAddress(target.address);
    },
    connect: async () => undefined,
    disconnect: undefined,
    signTransaction:
      wallet?.address && signWithPrivy
        ? async (tx) => (await signWithPrivy(tx, wallet.address)) as never
        : wallet?.signTransaction
          ? async (tx) => wallet.signTransaction!(tx as never)
          : undefined,
    signAllTransactions: undefined,
    signMessage: wallet?.signMessage
      ? async (message) => wallet.signMessage!(message)
      : undefined,
    sendTransaction: wallet?.sendTransaction
      ? async (tx, connection) =>
          wallet.sendTransaction!(tx as never, connection as never)
      : undefined,
  };
}
