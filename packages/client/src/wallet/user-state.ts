import type { UserState } from "../user-state";
import type { Wallets } from "./types";

export function walletUserState(wallets: Wallets): UserState | undefined {
  if (!wallets.evm && !wallets.svm) return undefined;
  const chainId =
    typeof wallets.evm?.chainId === "function"
      ? wallets.evm.chainId()
      : wallets.evm?.chainId;
  const cluster =
    typeof wallets.svm?.cluster === "function"
      ? wallets.svm.cluster()
      : wallets.svm?.cluster;
  return {
    connection: { is_connected: true },
    ...(wallets.evm
      ? {
          evm: {
            address: wallets.evm.address,
            ...(chainId === undefined ? {} : { chain_id: chainId }),
          },
        }
      : {}),
    ...(wallets.svm
      ? {
          svm: {
            address: wallets.svm.address,
            ...(cluster === undefined ? {} : { cluster }),
          },
        }
      : {}),
  };
}
