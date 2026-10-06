"use client";

import { WidgetStorageProvider, useWidgetStorage } from "@/lib/widget-storage";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { useStandardWalletAdapters } from "@solana/wallet-standard-wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExtUserProvider } from "@aomi-labs/react";
import {
  arc,
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
import { AomiWalletKitComposer } from "@/wallet/composer/aomi-wallet-kit-composer";
import {
  AOMI_BOOTING_WALLET_KIT,
  AomiWalletKitContextProvider,
} from "@/wallet/context";
import {
  createWalletAuthStore,
  useWalletAuthStore,
  WalletAuthPublisherContext,
  WalletDelegationPublisherContext,
  type WalletAuthStore,
} from "@/wallet/providers/auth-store";
import { PrivyDelegationContext } from "@/wallet/providers/privy/privy-delegation-context";
import type { AuthRuntime, ExecutionRuntime } from "@/wallet/composer/types";
import { useResolvedAccountRuntime } from "@/wallet/account/use-resolved-account-runtime";
import { buildEvmExecutionRuntime } from "@/wallet/execution/execution-runtime";
import {
  AomiWalletNetworkPreferencesProvider,
  useAomiWalletNetworkPreferences,
} from "@/wallet/network-preferences";
import {
  WalletChainRouter,
  useFullTestnet,
} from "@/wallet/full-testnet-wallet-routing";
import { AomiEvmRuntimeProvider } from "@/wallet/runtime/evm/provider";
import { useEvmWalletRuntime } from "@/wallet/runtime/evm/wallet-runtime";
import { useDisabledEvmWalletRuntime } from "@/wallet/runtime/evm/disabled-runtime";
import {
  useSafeSvmWallet,
  useSvmWalletRuntime,
} from "@/wallet/runtime/svm/wallet-runtime";
import { FullTestnetConfigContext } from "@/wallet/full-testnet-config";
import {
  createAomiEvmConfig,
  type ResolvedEvmWalletsConfig,
} from "@/wallet/catalog/evm-connector-catalog";
import { resolveAomiSvmConfig } from "@/wallet/catalog/svm-wallet-catalog";
import { canonicalWalletKey } from "@/wallet/catalog/wallet-branding";
import {
  detectProviderSugar,
  getWalletProvider,
  type WalletProviderPlugin,
} from "@/wallet/providers/plugin-registry";
import { MissingWalletSdkError } from "@/wallet/providers/sdk-loaders";
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
  arc,
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
  const storage = useWidgetStorage();
  const evmRuntime = useEvmWalletRuntime({
    configuredChains: supportedChains,
    selectedEvmChainId,
    setSelectedEvmChainId,
    storageKey: storage.key("walletRegistry"),
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
  const storage = useWidgetStorage();
  const evmRuntime = useDisabledEvmWalletRuntime({
    storageKey: storage.key("walletRegistry"),
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
      `[aomi-wallet-kit] Auth provider "${authPlugin.id}" is requested by \`auth\` but unavailable: its public credential is missing (providers.${authPlugin.id} apiKey/appId). The wallet picker will show browser wallets only.`,
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
      <WalletChainRouter
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
      </WalletChainRouter>
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

function WalletAuthBridge({
  store,
  children,
}: {
  store: WalletAuthStore;
  children: ReactNode;
}) {
  const snapshot = useWalletAuthStore(store);
  const { supportedEvmChains, supportedSolanaNetworks } =
    useAomiWalletNetworkPreferences();
  // Supported networks are host configuration, available before a wallet SDK.
  // Publishing them on the initial shell paint keeps the header pill in place
  // without presenting a booting provider as ready or connected.
  // An island failure surfaces as the account error, which the account chip
  // and wallet picker render inside the widget root.
  const kit = useMemo(() => {
    const base =
      snapshot.kit === AOMI_BOOTING_WALLET_KIT
        ? {
            ...snapshot.kit,
            supportedChains: supportedEvmChains,
            supportedNetworks: {
              evm: supportedEvmChains,
              solana: supportedSolanaNetworks,
            },
          }
        : snapshot.kit;
    return snapshot.failure
      ? { ...base, accountError: snapshot.failure }
      : base;
  }, [
    snapshot.failure,
    snapshot.kit,
    supportedEvmChains,
    supportedSolanaNetworks,
  ]);
  return (
    <PrivyDelegationContext.Provider value={snapshot.delegation}>
      <AomiWalletKitContextProvider value={kit}>
        {children}
      </AomiWalletKitContextProvider>
    </PrivyDelegationContext.Provider>
  );
}

function WalletRuntimeIsland({
  store,
  authPlugin,
  unknownProvider,
  ...props
}: Parameters<typeof AomiExternalWalletProvider>[0] & {
  store: WalletAuthStore;
  unknownProvider?: string;
}) {
  const [loaded, setLoaded] = useState<WalletProviderPlugin | undefined>(() =>
    authPlugin?.load ? undefined : authPlugin,
  );
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    return () => {
      store.publish(AOMI_BOOTING_WALLET_KIT);
      store.publishDelegation(null);
      store.publishFailure(null);
    };
  }, [store]);
  useEffect(() => {
    if (unknownProvider)
      store.publishFailure(
        `Unknown wallet provider "${unknownProvider}". Use auth type "privy", "para" or "browser_wallet".`,
      );
  }, [store, unknownProvider]);
  useEffect(() => {
    let active = true;
    if (authPlugin?.load) {
      void authPlugin
        .load()
        .then((plugin) => {
          if (active) setLoaded(plugin);
        })
        .catch((error: unknown) => {
          if (!active) return;
          setFailed(true);
          store.publishFailure(
            error instanceof MissingWalletSdkError
              ? error.message
              : `Couldn’t load ${authPlugin.id}. Choose the provider again to retry.`,
          );
        });
    }
    return () => {
      active = false;
    };
  }, [authPlugin, store]);
  if (authPlugin?.load && !loaded && !failed) return null;
  return (
    <WalletAuthPublisherContext.Provider value={store.publish}>
      <WalletDelegationPublisherContext.Provider
        value={store.publishDelegation}
      >
        <AomiExternalWalletProvider {...props} authPlugin={loaded}>
          {null}
        </AomiExternalWalletProvider>
      </WalletDelegationPublisherContext.Provider>
    </WalletAuthPublisherContext.Provider>
  );
}

class WalletIslandErrorBoundary extends Component<
  { children: ReactNode; store: WalletAuthStore },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.store.publishFailure(
      "Couldn’t start the wallet provider. Choose it again to retry.",
    );
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function AomiWalletKitProvider(input: AomiWalletKitProviderInput) {
  const [store] = useState(createWalletAuthStore);
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
  const authPlugin = authProvider ? getWalletProvider(authProvider) : undefined;
  const networkPreferencesStorageKey =
    props.account && props.account.mode === "aomi-backend"
      ? null
      : "wallets-only";

  return (
    <WidgetStorageProvider
      scope={{
        backendUrl:
          props.account && props.account.mode === "aomi-backend"
            ? (props.account.baseUrl ?? "")
            : "",
        appId: props.applicationId,
      }}
    >
      <FullTestnetConfigContext.Provider value={props.fullTestnet}>
        <ExtUserProvider>
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
            <WalletAuthBridge store={store}>{props.children}</WalletAuthBridge>
            {!props.initializing && (
              <WalletIslandErrorBoundary
                store={store}
                key={`${authProvider ?? "browser-wallet"}:${props.providerAttempt ?? 0}`}
              >
                <WalletRuntimeIsland
                  key={`${authProvider ?? "browser-wallet"}:${props.providerAttempt ?? 0}`}
                  store={store}
                  account={props.account}
                  auth={auth}
                  authPlugin={authPlugin}
                  unknownProvider={authPlugin ? undefined : authProvider}
                  execution={props.execution}
                  providers={props.providers}
                  wallets={props.wallets}
                >
                  {null}
                </WalletRuntimeIsland>
              </WalletIslandErrorBoundary>
            )}
          </AomiWalletNetworkPreferencesProvider>
        </ExtUserProvider>
      </FullTestnetConfigContext.Provider>
    </WidgetStorageProvider>
  );
}
