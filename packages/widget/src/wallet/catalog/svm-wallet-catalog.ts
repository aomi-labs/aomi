"use client";

import type { SvmNetworkOption } from "../types";
import {
  normalizeSvmNetworkOptions,
  resolveSelectedSvmNetwork,
} from "./svm-networks";
import type { SvmWalletId, SvmWalletPreset } from "./wallet-ids";
import { SVM_PRESETS } from "./wallet-ids";

export type SvmWalletsConfig = {
  preset?: SvmWalletPreset;
  wallets?: readonly SvmWalletId[];
  networks?: readonly SvmNetworkOption[];
  preferDirectSend?: boolean;
  enabled?: boolean;
};

export const SVM_WALLET_ALLOWLIST = new Set<string>(SVM_PRESETS.popular);

export function resolveAomiSvmWalletIds(
  input: Pick<SvmWalletsConfig, "preset" | "wallets"> = {},
): readonly SvmWalletId[] {
  return input.wallets ?? SVM_PRESETS[input.preset ?? "popular"];
}

export function resolveAomiSvmConfig(
  input: SvmWalletsConfig | false | undefined,
  selectedNetworkId?: string,
) {
  if (input === false) {
    return {
      enabled: false,
      networks: [],
      activeNetwork: undefined,
      cluster: undefined,
      rpcHttpUrl: undefined,
      rpcWsUrl: undefined,
      walletIds: [] as readonly SvmWalletId[],
      preferDirectSend: true,
    };
  }

  const networks = normalizeSvmNetworkOptions(input);
  const activeNetwork = resolveSelectedSvmNetwork(networks, selectedNetworkId);
  return {
    enabled: input?.enabled ?? true,
    networks,
    activeNetwork,
    cluster: activeNetwork.cluster,
    rpcHttpUrl: activeNetwork.rpcHttpUrl,
    rpcWsUrl: activeNetwork.rpcWsUrl,
    walletIds: resolveAomiSvmWalletIds(input),
    preferDirectSend: input?.preferDirectSend ?? true,
  };
}

export { SVM_PRESETS };
