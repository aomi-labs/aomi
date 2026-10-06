"use client";

import type { SafeSvmWalletState } from "../../runtime/svm/wallet-runtime";
import { formatWalletAddress } from "../../identity";
import type { PrivySolanaWallet } from "./privy-auth";

export function buildPrivySvmWalletState({
  wallet,
  wallets,
  setActiveAddress,
}: {
  wallet: PrivySolanaWallet | undefined;
  wallets: readonly PrivySolanaWallet[];
  setActiveAddress: (address: string) => void;
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
        walletName.toString().includes(formatWalletAddress(entry.address) ?? ""),
      );
      if (target?.address) setActiveAddress(target.address);
    },
    connect: async () => undefined,
    disconnect: undefined,
    signTransaction: wallet?.signTransaction
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
