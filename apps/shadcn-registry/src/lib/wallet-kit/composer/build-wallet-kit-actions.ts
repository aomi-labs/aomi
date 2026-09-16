"use client";

import type { AomiAccount, AomiWalletKit } from "../types";
import type { WalletRegistryStore } from "../registry/store";
import type { AuthRuntime, ExecutionRuntime } from "./types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import type { SvmWalletRuntime, SvmIdentity } from "./types";
import { toRegistryFamily } from "../wallet-utils";

type BuildWalletKitActionsParams = {
  accounts: readonly AomiAccount[];
  auth: AuthRuntime;
  evm: EvmWalletRuntime;
  svm?: SvmWalletRuntime;
  execution: ExecutionRuntime;
  registryStore: WalletRegistryStore;
  evmAddress?: string;
  registryEvmConnected: boolean;
  svmIdentity?: SvmIdentity;
};

type WalletKitActions = Pick<
  AomiWalletKit,
  | "selectAccount"
  | "connectEvmWallet"
  | "connectSocial"
  | "connectSolanaWallet"
  | "connect"
  | "disconnect"
  | "openAccountUI"
  | "switchChain"
  | "selectNetwork"
>;

export function buildWalletKitActions({
  accounts,
  auth,
  evm,
  svm,
  execution,
  registryStore,
  evmAddress,
  registryEvmConnected,
  svmIdentity,
}: BuildWalletKitActionsParams): WalletKitActions {
  return {
    selectAccount: async (id: string) => {
      const target = accounts.find(
        (account) =>
          account.id === id ||
          (account.family === "evm" && account.connectorIds?.includes(id)),
      );
      if (!target) {
        throw new Error(`Unknown account: ${id}`);
      }
      if (target.family === "evm") {
        await evm.selectAccount(id);
        return;
      }
      await svm?.selectAccount(id);
    },
    connectEvmWallet: evm.connect,
    connectSocial: async (id: string) => {
      await auth.login?.(`social-login:${id}`);
    },
    connectSolanaWallet: svm
      ? async (walletName: string) => {
          await svm.connect(walletName);
        }
      : undefined,
    connect: async (options) => {
      const requestedFamily = toRegistryFamily(options?.family);
      if (requestedFamily === "svm" && svm) {
        await svm.connect();
        return;
      }
      if (requestedFamily === "evm" && (evmAddress || registryEvmConnected)) {
        return;
      }
      await auth.login?.("auth-modal");
    },
    disconnect: async (options) => {
      if (options?.accountId) {
        const target = accounts.find((a) => a.id === options.accountId);
        if (target?.family === "evm") {
          await evm.disconnect(target.id);
        }
        if (target?.family === "svm") {
          await svm?.disconnect(target.id);
        }
        if (target && options.providerSignOut) {
          auth.startFlow?.("provider-logout");
          await auth.logout?.();
        }
        return;
      }

      const requestedFamily = options?.family ?? "all";
      const registryFamily =
        requestedFamily === "all" ? "all" : toRegistryFamily(requestedFamily);
      const wantsAll = requestedFamily === "all";
      auth.startFlow?.(wantsAll ? "provider-logout" : "family-disconnect");
      if (wantsAll) {
        registryStore.dispatch({
          type: "user/disconnect-family",
          family: "all",
          now: Date.now(),
        });
        await auth.logout?.();
        return;
      }
      if (registryFamily === "evm") {
        await evm.disconnect();
        return;
      }
      await svm?.disconnect();
    },
    openAccountUI: async (options) => {
      const requestedFamily = toRegistryFamily(options?.family);
      if (requestedFamily === "svm" && svm && !svmIdentity?.address) {
        await svm.connect();
        return;
      }
      await auth.openAccountUI?.("account-modal", "ACCOUNT_MAIN");
    },
    switchChain: execution.evm.switchChainAsync
      ? async (chainId: number) => evm.selectNetwork(chainId)
      : undefined,
    selectNetwork: async (target) => {
      if (target.family === "evm") {
        await evm.selectNetwork(target.chainId);
        return;
      }
      await svm?.selectNetwork(target.networkId);
    },
  } satisfies WalletKitActions;
}
