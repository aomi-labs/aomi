"use client";

import { useCallback, useMemo } from "react";
import { selectAccounts, selectEvmIdentity } from "../../registry/selectors";
import { useWalletRegistry } from "../../registry/use-wallet-registry";
import type { CommandExecutors } from "../../registry/store";
import type { EvmWalletRuntime } from "./wallet-runtime";

const disabledExecutors: CommandExecutors = {
  wagmiReconnect: async () => undefined,
  wagmiConnect: async () => undefined,
  wagmiDisconnect: async () => undefined,
  providerLogout: async () => undefined,
};

function rejectDisabledEvm(): never {
  throw new Error("EVM wallets are disabled for this wallet kit instance.");
}

export function useDisabledEvmWalletRuntime({
  storageKey,
}: {
  storageKey: string;
}): EvmWalletRuntime {
  const { store: registryStore, state: registryState } = useWalletRegistry({
    executors: disabledExecutors,
    storageKey,
  });

  const selectRuntimeAccounts = useCallback(
    (now: number) => selectAccounts(registryState, "evm", now, undefined),
    [registryState],
  );
  const selectRuntimeEvmIdentity = useCallback(
    (now: number) => selectEvmIdentity(registryState, now, undefined),
    [registryState],
  );
  const getWalletClientFor = useCallback(async () => null, []);
  const reject = useCallback(async () => rejectDisabledEvm(), []);

  return useMemo(
    () => ({
      registryStore,
      registryState,
      status: "unavailable" as const,
      activeEvmConnection: undefined,
      activeConnector: undefined,
      capabilities: undefined,
      chainsById: {},
      supportedChains: [],
      walletClient: undefined,
      getWalletClientFor,
      sendTransactionAsync: undefined,
      sendCallsSyncAsync: undefined,
      signTypedDataAsync: undefined,
      signMessageAsync: undefined,
      signMessageForAccount: undefined,
      switchChainAsync: undefined,
      isSwitchingChain: false,
      activeAccount: undefined,
      options: [],
      shouldUseExternalSigner: false,
      identity: selectRuntimeEvmIdentity,
      accounts: selectRuntimeAccounts,
      selectAccount: async (_id: string) => undefined,
      connect: reject,
      disconnect: async (_accountId?: string) => undefined,
      selectNetwork: reject,
    }),
    [
      getWalletClientFor,
      registryState,
      registryStore,
      reject,
      selectRuntimeAccounts,
      selectRuntimeEvmIdentity,
    ],
  );
}
