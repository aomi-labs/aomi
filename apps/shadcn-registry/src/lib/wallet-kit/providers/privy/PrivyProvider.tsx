"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  PrivyProvider as PrivyAuthProvider,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Chain } from "viem";
import {
  arbitrum,
  base,
  linea,
  lineaSepolia,
  mainnet,
  optimism,
  polygon,
  sepolia,
} from "wagmi/chains";
import { ExtUserProvider } from "@aomi-labs/react";
import { arc, arcTestnet, megaeth, robinhood } from "@aomi-labs/client";
import { createAomiEvmConfig } from "../../catalog/evm-connector-catalog";
import {
  AomiWalletNetworkPreferencesProvider,
  useAomiWalletNetworkPreferences,
} from "../../network-preferences";
import { normalizeSvmNetworkOptions } from "../../catalog/svm-networks";
import type { SvmCluster, SvmNetworkOption } from "../../types";
import { safeEnv } from "../../env";
import type { EvmWalletsConfig, ExecutionConfig } from "../../config/types";
import { AomiPrivyPluginProvider } from "./PrivyPluginProvider";
import { buildPrivyClientConfig } from "./privy-auth";

const defaultNetworks = [
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  sepolia,
  linea,
  lineaSepolia,
  robinhood,
  megaeth,
  arc,
  arcTestnet,
] as const;

export type AomiPrivyProviderProps = {
  children: ReactNode;
  appId?: string;
  appName?: string;
  appLogoUrl?: string;
  networks?: readonly [Chain, ...Chain[]];
  wallets?: EvmWalletsConfig;
  loginMethods?: PrivyClientConfig["loginMethods"];
  walletConnectProjectId?: string;
  execution?: ExecutionConfig;
  solana?: {
    networks?: readonly SvmNetworkOption[];
    cluster?: SvmCluster;
    rpcHttpUrl?: string;
    rpcWsUrl?: string;
    preferDirectSend?: boolean;
  };
};

function AomiPrivyProviderInner({
  children,
  appId = safeEnv(() => process.env.NEXT_PUBLIC_PRIVY_APP_ID),
  appName = "Aomi",
  appLogoUrl,
  networks = defaultNetworks,
  wallets,
  loginMethods,
  execution,
  solana,
  walletConnectProjectId = safeEnv(
    () => process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  ),
}: AomiPrivyProviderProps) {
  const [queryClient] = useState(() => new QueryClient());
  const { selectedEvmChainId } = useAomiWalletNetworkPreferences();
  const defaultEvmChain =
    networks.find((chain) => chain.id === selectedEvmChainId) ?? networks[0];
  const wagmiConfig = useMemo(
    () =>
      createAomiEvmConfig({
        chains: networks,
        preset: wallets?.preset,
        wallets: wallets?.wallets,
        connectors: wallets?.connectors,
        walletConnectProjectId,
        coinbase: wallets?.coinbase,
        appName,
        appLogoUrl,
        transports: wallets?.transports,
      }),
    [appLogoUrl, appName, networks, walletConnectProjectId, wallets],
  );

  const adapter = (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <SmartWalletsProvider>
          <AomiPrivyPluginProvider
            supportedChains={networks}
            loginMethods={loginMethods}
            execution={execution}
            preferDirectSend={solana?.preferDirectSend}
          >
            {children}
          </AomiPrivyPluginProvider>
        </SmartWalletsProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );

  if (!appId) return adapter;

  return (
    <PrivyAuthProvider
      appId={appId}
      config={buildPrivyClientConfig({
        appLogoUrl,
        appName,
        loginMethods,
        defaultChain: defaultEvmChain,
        supportedChains: networks,
        walletConnectProjectId,
      })}
    >
      {adapter}
    </PrivyAuthProvider>
  );
}

export function AomiPrivyProvider({
  networks = defaultNetworks,
  wallets,
  solana,
  ...rest
}: AomiPrivyProviderProps) {
  const supportedSolanaNetworks = useMemo(
    () => normalizeSvmNetworkOptions(solana),
    [solana],
  );

  return (
    <AomiWalletNetworkPreferencesProvider
      evmChains={networks}
      solanaNetworks={supportedSolanaNetworks}
      storageKey="privy"
    >
      <ExtUserProvider>
        <AomiPrivyProviderInner
          {...rest}
          networks={networks}
          solana={solana}
          wallets={wallets}
        />
      </ExtUserProvider>
    </AomiWalletNetworkPreferencesProvider>
  );
}
