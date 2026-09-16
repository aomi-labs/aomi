"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { useStandardWalletAdapters } from "@solana/wallet-standard-wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExtUserProvider } from "@aomi-labs/react";
import {
  arcTestnet,
  megaeth,
  monad,
  monadTestnet,
  robinhood,
} from "@aomi-labs/client";
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
import type { Chain } from "viem";
import { AomiWalletKitComposer } from "../composer/AomiWalletKitComposer";
import type { AuthRuntime, ExecutionRuntime } from "../composer/types";
import { useResolvedAccountRuntime } from "../account/use-resolved-account-runtime";
import { buildEvmExecutionRuntime } from "../execution/execution-runtime";
import {
  AomiWalletNetworkPreferencesProvider,
  useAomiWalletNetworkPreferences,
} from "../network-preferences";
import {
  FullTestnetWalletRouter,
  useFullTestnet,
} from "../full-testnet-wallet-routing";
import { AomiEvmRuntimeProvider } from "../runtime/evm/provider";
import { useEvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import { useDisabledEvmWalletRuntime } from "../runtime/evm/disabled-runtime";
import {
  useSafeSvmWallet,
  useSvmWalletRuntime,
} from "../runtime/svm/wallet-runtime";
import { REGISTRY_STORAGE_KEY } from "../registry/types";
import {
  createAomiEvmConfig,
  type ResolvedEvmWalletsConfig,
} from "../catalog/evm-connector-catalog";
import { resolveAomiSvmConfig } from "../catalog/svm-wallet-catalog";
import { canonicalWalletKey } from "../catalog/wallet-branding";
import {
  detectProviderSugar,
  requireWalletProvider,
  type WalletProviderPlugin,
} from "../providers/plugin-registry";
import type {
  AccountConfig,
  AomiWalletKitProviderInput,
  AomiWalletKitProviderProps,
  AuthConfig,
  ExecutionConfig,
  ProvidersConfig,
  WalletsConfig,
} from "./types";
import { resolveConfiguredNativeWalletExecutionPolicy } from "./execution";
import { resolveEvmConnectionPersistence } from "./evm-connection-persistence";

export type { AomiWalletKitProviderInput, AomiWalletKitProviderProps };

const defaultNetworks = [
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  sepolia,
  linea,
  lineaSepolia,
  monad,
  monadTestnet,
  robinhood,
  megaeth,
  arcTestnet,
] as const;

type ResolvedSvmWalletsConfig = ReturnType<typeof resolveAomiSvmConfig>;

function ExternalWalletComposerProvider({
  account,
  children,
  evmRuntime,
  execution,
  svmRuntime,
  supportedChains,
}: {
  account?: AccountConfig;
  children: ReactNode;
  evmRuntime: ReturnType<typeof useEvmWalletRuntime>;
  execution?: ExecutionConfig;
  svmRuntime?: ReturnType<typeof useSvmWalletRuntime>;
  supportedChains: readonly Chain[];
}) {
  const authRuntime = useMemo<AuthRuntime>(
    () => ({
      provider: "none",
      status: "unauthenticated",
      methods: [],
      canOpenModal: false,
    }),
    [],
  );
  const executionRuntime = useMemo<ExecutionRuntime>(
    () => ({
      evm: buildEvmExecutionRuntime(evmRuntime, {
        nativeWalletExecution:
          resolveConfiguredNativeWalletExecutionPolicy(execution),
      }),
    }),
    [evmRuntime, execution],
  );
  const accountRuntime = useResolvedAccountRuntime({
    account,
    auth: authRuntime,
    evm: evmRuntime,
    svm: svmRuntime,
  });

  return (
    <AomiWalletKitComposer
      auth={authRuntime}
      account={accountRuntime}
      evm={evmRuntime}
      svm={svmRuntime}
      execution={executionRuntime}
      supportedChains={supportedChains}
    >
      {children}
    </AomiWalletKitComposer>
  );
}

function ExternalWalletComposerSvmProvider({
  account,
  children,
  evmRuntime,
  execution,
  selectedSolanaNetwork,
  setSelectedSolanaNetworkId,
  supportedChains,
  supportedSolanaNetworks,
  preferDirectSend,
}: {
  account?: AccountConfig;
  children: ReactNode;
  evmRuntime: ReturnType<typeof useEvmWalletRuntime>;
  execution?: ExecutionConfig;
  preferDirectSend: boolean;
  selectedSolanaNetwork?: ResolvedSvmWalletsConfig["activeNetwork"];
  setSelectedSolanaNetworkId: (networkId: string) => void;
  supportedChains: readonly Chain[];
  supportedSolanaNetworks: ResolvedSvmWalletsConfig["networks"];
}) {
  const svmWallet = useSafeSvmWallet();
  const svmRuntime = useSvmWalletRuntime({
    preferDirectSend,
    registryStore: evmRuntime.registryStore,
    selectedNetwork: selectedSolanaNetwork,
    supportedNetworks: supportedSolanaNetworks,
    setSelectedNetworkId: setSelectedSolanaNetworkId,
    wallet: svmWallet,
  });

  return (
    <ExternalWalletComposerProvider
      account={account}
      evmRuntime={evmRuntime}
      execution={execution}
      svmRuntime={svmRuntime}
      supportedChains={supportedChains}
    >
      {children}
    </ExternalWalletComposerProvider>
  );
}

function EvmExternalWalletComposerProvider({
  account,
  children,
  execution,
  resolvedSvm,
  supportedChains,
}: {
  account?: AccountConfig;
  children: ReactNode;
  execution?: ExecutionConfig;
  resolvedSvm: ResolvedSvmWalletsConfig;
  supportedChains: readonly Chain[];
}) {
  const {
    selectedEvmChainId,
    selectedSolanaNetwork,
    setSelectedEvmChainId,
    setSelectedSolanaNetworkId,
    supportedSolanaNetworks,
  } = useAomiWalletNetworkPreferences();
  const evmRuntime = useEvmWalletRuntime({
    configuredChains: supportedChains,
    selectedEvmChainId,
    setSelectedEvmChainId,
    storageKey: REGISTRY_STORAGE_KEY,
  });

  if (resolvedSvm.enabled && resolvedSvm.activeNetwork) {
    return (
      <ExternalWalletComposerSvmProvider
        account={account}
        evmRuntime={evmRuntime}
        execution={execution}
        selectedSolanaNetwork={selectedSolanaNetwork}
        setSelectedSolanaNetworkId={setSelectedSolanaNetworkId}
        supportedChains={supportedChains}
        supportedSolanaNetworks={supportedSolanaNetworks}
        preferDirectSend={resolvedSvm.preferDirectSend}
      >
        {children}
      </ExternalWalletComposerSvmProvider>
    );
  }

  return (
    <ExternalWalletComposerProvider
      account={account}
      evmRuntime={evmRuntime}
      execution={execution}
      supportedChains={supportedChains}
    >
      {children}
    </ExternalWalletComposerProvider>
  );
}

function SvmExternalWalletComposerProvider({
  account,
  children,
  resolvedSvm,
}: {
  account?: AccountConfig;
  children: ReactNode;
  resolvedSvm: ResolvedSvmWalletsConfig;
}) {
  const {
    selectedSolanaNetwork,
    setSelectedSolanaNetworkId,
    supportedSolanaNetworks,
  } = useAomiWalletNetworkPreferences();
  const evmRuntime = useDisabledEvmWalletRuntime({
    storageKey: REGISTRY_STORAGE_KEY,
  });

  if (resolvedSvm.enabled && resolvedSvm.activeNetwork) {
    return (
      <ExternalWalletComposerSvmProvider
        account={account}
        evmRuntime={evmRuntime}
        selectedSolanaNetwork={selectedSolanaNetwork}
        setSelectedSolanaNetworkId={setSelectedSolanaNetworkId}
        supportedChains={[]}
        supportedSolanaNetworks={supportedSolanaNetworks}
        preferDirectSend={resolvedSvm.preferDirectSend}
      >
        {children}
      </ExternalWalletComposerSvmProvider>
    );
  }

  return (
    <ExternalWalletComposerProvider
      account={account}
      evmRuntime={evmRuntime}
      supportedChains={[]}
    >
      {children}
    </ExternalWalletComposerProvider>
  );
}

function MaybeSvmWalletProvider({
  children,
  resolvedSvm,
}: {
  children: ReactNode;
  resolvedSvm: ResolvedSvmWalletsConfig;
}) {
  const standardWalletAdapters = useStandardWalletAdapters([]);
  const walletAdapters = useMemo(() => {
    const wanted = new Set<string>(resolvedSvm.walletIds);
    return standardWalletAdapters.filter((adapter) =>
      wanted.has(canonicalWalletKey(adapter.name)),
    );
  }, [resolvedSvm.walletIds, standardWalletAdapters]);

  if (!resolvedSvm.enabled || !resolvedSvm.activeNetwork) {
    return <>{children}</>;
  }

  return (
    <ConnectionProvider endpoint={resolvedSvm.rpcHttpUrl}>
      <WalletProvider wallets={walletAdapters} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

function WalletKitComposerOutlet({
  account,
  auth,
  authPlugin,
  children,
  execution,
  providers,
  resolvedSvm,
  routing,
  setSelectedSolanaNetworkId,
}: {
  account?: AccountConfig;
  auth?: AuthConfig;
  authPlugin?: WalletProviderPlugin;
  children: ReactNode;
  execution?: ExecutionConfig;
  providers?: ProvidersConfig;
  resolvedSvm: ResolvedSvmWalletsConfig;
  routing: ReturnType<typeof useFullTestnet<readonly [Chain, ...Chain[]]>>;
  setSelectedSolanaNetworkId: (networkId: string) => void;
}) {
  const externalSvmWallet = useSafeSvmWallet();
  if (authPlugin?.renderComposer) {
    return (
      <>
        {authPlugin.renderComposer({
          account,
          auth,
          children,
          execution,
          externalSvmWallet,
          providers,
          selectedSolanaNetwork: resolvedSvm.activeNetwork,
          setSelectedSolanaNetworkId,
          solanaRuntimeConfig:
            resolvedSvm.enabled && resolvedSvm.activeNetwork
              ? {
                  cluster: resolvedSvm.cluster,
                  rpcHttpUrl: resolvedSvm.rpcHttpUrl,
                  rpcWsUrl: resolvedSvm.rpcWsUrl,
                  preferDirectSend: resolvedSvm.preferDirectSend,
                }
              : undefined,
          supportedChains: routing.routedChains,
          supportedSolanaNetworks: resolvedSvm.networks,
        })}
      </>
    );
  }

  return (
    <EvmExternalWalletComposerProvider
      account={account}
      execution={execution}
      resolvedSvm={resolvedSvm}
      supportedChains={routing.routedChains}
    >
      {children}
    </EvmExternalWalletComposerProvider>
  );
}

function DefaultEvmRuntimeProvider({
  children,
  config,
  reconnectOnMount,
}: {
  children: ReactNode;
  config: ResolvedEvmWalletsConfig;
  reconnectOnMount: boolean;
}) {
  const wagmiConfig = useMemo(() => createAomiEvmConfig(config), [config]);
  return (
    <AomiEvmRuntimeProvider
      config={wagmiConfig}
      reconnectOnMount={reconnectOnMount}
    >
      {children}
    </AomiEvmRuntimeProvider>
  );
}

function AomiEvmExternalWalletProvider({
  account,
  auth,
  authPlugin,
  children,
  evmWallets,
  execution,
  providers,
  resolvedSvm,
  setSelectedSolanaNetworkId,
}: {
  account?: AccountConfig;
  auth?: AuthConfig;
  authPlugin?: WalletProviderPlugin;
  children: ReactNode;
  evmWallets: Exclude<WalletsConfig["evm"], false | undefined> | undefined;
  execution?: ExecutionConfig;
  providers?: ProvidersConfig;
  resolvedSvm: ResolvedSvmWalletsConfig;
  setSelectedSolanaNetworkId: (networkId: string) => void;
}) {
  const chains = evmWallets?.chains ?? defaultNetworks;
  const routing = useFullTestnet(chains);
  const persistExternalWallet = resolveEvmConnectionPersistence(evmWallets);
  const evmConfig = useMemo(
    () => ({
      chains: routing.routedChains,
      preset: evmWallets?.preset,
      wallets: evmWallets?.wallets,
      connectors: evmWallets?.connectors,
      walletConnectProjectId: evmWallets?.walletConnectProjectId,
      coinbase: evmWallets?.coinbase,
      appName: evmWallets?.appName,
      appLogoUrl: evmWallets?.appLogoUrl,
      transports: evmWallets?.transports,
      persistConnections: persistExternalWallet,
    }),
    [evmWallets, persistExternalWallet, routing.routedChains],
  );
  const [queryClient] = useState(() => new QueryClient());
  const authPluginAvailable =
    authPlugin?.isAvailable?.({ auth, providers }) ?? true;
  useEffect(() => {
    if (!authPlugin || authPluginAvailable) return;
    console.warn(
      `[aomi-wallet-kit] Auth provider "${authPlugin.id}" is requested by \`auth\` but unavailable: its public credential is missing (providers.${authPlugin.id} apiKey/appId, or the matching NEXT_PUBLIC_* env inlined by the host bundler). The wallet picker will show browser wallets only.`,
    );
  }, [authPlugin, authPluginAvailable]);
  const shouldUseAuthPlugin = Boolean(
    authPlugin?.renderComposer && authPluginAvailable,
  );
  const wrapWithAuthProvider =
    authPlugin?.wrap ??
    ((props: { children: ReactNode }) => <>{props.children}</>);
  const runtimeChildren = (
    <MaybeSvmWalletProvider resolvedSvm={resolvedSvm}>
      <FullTestnetWalletRouter
        enabled={routing.enabled}
        chains={routing.routedChains}
        routedChainIds={routing.routedChainIds}
      >
        <WalletKitComposerOutlet
          account={account}
          auth={auth}
          authPlugin={shouldUseAuthPlugin ? authPlugin : undefined}
          execution={execution}
          providers={providers}
          resolvedSvm={resolvedSvm}
          routing={routing}
          setSelectedSolanaNetworkId={setSelectedSolanaNetworkId}
        >
          {children}
        </WalletKitComposerOutlet>
      </FullTestnetWalletRouter>
    </MaybeSvmWalletProvider>
  );
  const evmRuntime =
    shouldUseAuthPlugin && authPlugin?.renderEvmRuntimeProvider ? (
      authPlugin.renderEvmRuntimeProvider({
        config: evmConfig,
        children: runtimeChildren,
      })
    ) : (
      <DefaultEvmRuntimeProvider
        config={evmConfig}
        reconnectOnMount={persistExternalWallet}
      >
        {runtimeChildren}
      </DefaultEvmRuntimeProvider>
    );

  return (
    <QueryClientProvider client={queryClient}>
      {wrapWithAuthProvider({
        auth,
        providers,
        children: evmRuntime,
      })}
    </QueryClientProvider>
  );
}

function AomiSvmExternalWalletProvider({
  account,
  children,
  resolvedSvm,
}: {
  account?: AccountConfig;
  children: ReactNode;
  resolvedSvm: ResolvedSvmWalletsConfig;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <MaybeSvmWalletProvider resolvedSvm={resolvedSvm}>
        <SvmExternalWalletComposerProvider
          account={account}
          resolvedSvm={resolvedSvm}
        >
          {children}
        </SvmExternalWalletComposerProvider>
      </MaybeSvmWalletProvider>
    </QueryClientProvider>
  );
}

function AomiExternalWalletProvider({
  account,
  auth,
  authPlugin,
  children,
  execution,
  providers,
  wallets,
}: {
  account?: AccountConfig;
  auth?: AuthConfig;
  authPlugin?: WalletProviderPlugin;
  children: ReactNode;
  execution?: ExecutionConfig;
  providers?: ProvidersConfig;
  wallets?: WalletsConfig;
}) {
  const evmWallets = wallets?.evm === false ? undefined : wallets?.evm;
  const evmEnabled = wallets?.evm !== false;
  const svmWallets = wallets?.solana === false ? false : wallets?.solana;
  const { selectedSolanaNetworkId, setSelectedSolanaNetworkId } =
    useAomiWalletNetworkPreferences();
  const resolvedSvm = useMemo(
    () => resolveAomiSvmConfig(svmWallets, selectedSolanaNetworkId),
    [selectedSolanaNetworkId, svmWallets],
  );

  if (!evmEnabled) {
    return (
      <AomiSvmExternalWalletProvider
        account={account}
        resolvedSvm={resolvedSvm}
      >
        {children}
      </AomiSvmExternalWalletProvider>
    );
  }

  return (
    <AomiEvmExternalWalletProvider
      account={account}
      auth={auth}
      authPlugin={authPlugin}
      evmWallets={evmWallets}
      execution={execution}
      providers={providers}
      resolvedSvm={resolvedSvm}
      setSelectedSolanaNetworkId={setSelectedSolanaNetworkId}
    >
      {children}
    </AomiEvmExternalWalletProvider>
  );
}

export function AomiWalletKitProvider(input: AomiWalletKitProviderInput) {
  const props =
    detectProviderSugar(input) ?? (input as AomiWalletKitProviderProps);
  const presetProvider =
    props.preset && props.preset !== "wallets-only" ? props.preset : undefined;
  const auth =
    props.auth === undefined && presetProvider
      ? ({ provider: presetProvider } satisfies AuthConfig)
      : props.auth;
  const authProvider =
    auth !== false && auth?.provider ? auth.provider : undefined;
  const authPlugin = authProvider
    ? requireWalletProvider(authProvider)
    : undefined;
  const provider =
    presetProvider ??
    (authProvider && authPlugin?.authMode !== "additive"
      ? authProvider
      : "none");
  const networkPreferencesStorageKey =
    props.account && props.account.mode === "aomi-backend"
      ? null
      : "wallets-only";
  if (provider !== "none") {
    requireWalletProvider(provider);
  }

  return (
    <AomiWalletNetworkPreferencesProvider
      evmChains={
        props.wallets?.evm === false
          ? []
          : (props.wallets?.evm?.chains ?? defaultNetworks)
      }
      solanaNetworks={
        resolveAomiSvmConfig(
          props.wallets?.solana === false ? false : props.wallets?.solana,
        ).networks
      }
      storageKey={networkPreferencesStorageKey}
    >
      <ExtUserProvider>
        <AomiExternalWalletProvider
          account={props.account}
          auth={auth}
          authPlugin={authPlugin}
          execution={props.execution}
          providers={props.providers}
          wallets={props.wallets}
        >
          {props.children}
        </AomiExternalWalletProvider>
      </ExtUserProvider>
    </AomiWalletNetworkPreferencesProvider>
  );
}
