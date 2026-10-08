"use client";

import { WidgetStorageProvider, useWidgetStorage } from "@/lib/widget-storage";
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
import type { Config } from "wagmi";
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
import {
  createSheetChannel,
  SheetChannelContext,
} from "@/wallet/picker/sheet-channel";
import {
  SocialLoginOpener,
  SocialSignInOptions,
  useSocialSignIn,
  type SocialSignIn,
} from "./social-sign-in";

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
  // Creating a wagmi config announces to every injected wallet, which updates
  // the other mounted wallet configs; doing it while rendering is a
  // setState-during-render. The config is cached, so WalletConnect inits once.
  const [wagmiConfig, setWagmiConfig] = useState<Config | null>(null);
  useLayoutEffect(() => {
    setWagmiConfig(createAomiEvmConfig(config));
  }, [config]);
  if (!wagmiConfig) return null;
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
  // The provider SDK itself (`authPlugin.wrap`) is mounted above, by the islands.
  return shouldUseAuthPlugin && authPlugin?.renderEvmRuntimeProvider ? (
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
  return (
    <MaybeSvmWalletProvider resolvedSvm={resolvedSvm}>
      <SvmExternalWalletComposerProvider
        account={account}
        resolvedSvm={resolvedSvm}
      >
        {children}
      </SvmExternalWalletComposerProvider>
    </MaybeSvmWalletProvider>
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

/** Hands the previous runtime's kit over when the active provider changes. */
function RuntimeMount({
  store,
  children,
}: {
  store: WalletAuthStore;
  children: ReactNode;
}) {
  useLayoutEffect(
    () => () => {
      store.beginHandover();
      store.publishFailure(null);
    },
    [store],
  );
  return <>{children}</>;
}

/** One provider SDK. It stays mounted once loaded; only the active one hosts the runtime. */
function ProviderShell({
  plugin,
  auth,
  active,
  providers,
  store,
  signIn,
  children,
}: {
  plugin: WalletProviderPlugin;
  auth?: AuthConfig;
  active: boolean;
  providers?: ProvidersConfig;
  store: WalletAuthStore;
  signIn: SocialSignIn;
  children: ReactNode;
}) {
  const { id } = plugin;
  const { onFailure } = signIn;
  const shellAuth = useMemo<AuthConfig>(
    () => (active && auth && auth.provider === id ? auth : { provider: id }),
    [active, auth, id],
  );
  const publishFailure = useCallback(
    (message: string | null) => onFailure(id, message),
    [id, onFailure],
  );
  return (
    <WalletDelegationPublisherContext.Provider
      value={active ? store.publishDelegation : null}
    >
      {plugin.wrap
        ? plugin.wrap({
            auth: shellAuth,
            providers,
            onFailure: publishFailure,
            children,
          })
        : children}
    </WalletDelegationPublisherContext.Provider>
  );
}

type LoadedPlugin = WalletProviderPlugin | "failed";

function useLoadedPlugins(
  ids: readonly string[],
  onFailed: (id: string, message: string) => void,
): Record<string, LoadedPlugin> {
  const [loaded, setLoaded] = useState<Record<string, LoadedPlugin>>({});
  const loading = useRef(new Set<string>());
  useEffect(() => {
    for (const id of ids) {
      const plugin = getWalletProvider(id);
      if (!plugin || loaded[id] || loading.current.has(id)) continue;
      if (!plugin.load) {
        setLoaded((current) => ({ ...current, [id]: plugin }));
        continue;
      }
      loading.current.add(id);
      void plugin
        .load()
        .then((next) => setLoaded((current) => ({ ...current, [id]: next })))
        .catch((error: unknown) => {
          setLoaded((current) => ({ ...current, [id]: "failed" }));
          onFailed(
            id,
            error instanceof MissingWalletSdkError
              ? error.message
              : `Couldn’t load ${id}. Choose the provider again to retry.`,
          );
        })
        .finally(() => loading.current.delete(id));
    }
  }, [ids, loaded, onFailed]);
  // Plugins registered without a loader are ready on the first render.
  return useMemo(() => {
    const ready: Record<string, LoadedPlugin> = { ...loaded };
    for (const id of ids) {
      const plugin = getWalletProvider(id);
      if (plugin && !plugin.load && !ready[id]) ready[id] = plugin;
    }
    return ready;
  }, [ids, loaded]);
}

function WalletIslands({
  store,
  signIn,
  auth,
  active,
  unknownProvider,
  ...props
}: Omit<Parameters<typeof AomiExternalWalletProvider>[0], "authPlugin"> & {
  store: WalletAuthStore;
  signIn: SocialSignIn;
  active?: string;
  unknownProvider?: string;
}) {
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => {
    if (unknownProvider)
      store.publishFailure(
        `Unknown wallet provider "${unknownProvider}". Use auth type "privy", "para" or "browser_wallet".`,
      );
  }, [store, unknownProvider]);
  // Provider SDKs only host the EVM runtime; an SVM-only kit runs without them.
  const evmEnabled = props.wallets?.evm !== false;
  const { warmProviders, fail } = signIn;
  const shellIds = useMemo(
    () =>
      evmEnabled
        ? [...new Set([active, ...warmProviders])].filter((id): id is string =>
            Boolean(id && getWalletProvider(id)),
          )
        : [],
    [active, evmEnabled, warmProviders],
  );
  const plugins = useLoadedPlugins(shellIds, fail);
  const activePlugin = active ? plugins[active] : undefined;
  const activeLoading = Boolean(
    active && getWalletProvider(active)?.load && !activePlugin,
  );
  const runtimePlugin = activePlugin === "failed" ? undefined : activePlugin;
  const runtime = activeLoading ? null : (
    <RuntimeMount key={active ?? "browser-wallet"} store={store}>
      <AomiExternalWalletProvider
        {...props}
        auth={auth}
        authPlugin={runtimePlugin}
      >
        {null}
      </AomiExternalWalletProvider>
    </RuntimeMount>
  );
  const runtimeInShell = Boolean(
    runtimePlugin && active && shellIds.includes(active),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <WalletAuthPublisherContext.Provider value={store.publish}>
        {shellIds.map((id) => {
          const plugin = plugins[id];
          if (!plugin || plugin === "failed") return null;
          return (
            <ProviderShell
              key={id}
              plugin={plugin}
              auth={auth}
              active={id === active}
              providers={props.providers}
              store={store}
              signIn={signIn}
            >
              {id === active ? runtime : null}
            </ProviderShell>
          );
        })}
        {runtimeInShell ? null : runtime}
      </WalletAuthPublisherContext.Provider>
    </QueryClientProvider>
  );
}

class WalletIslandErrorBoundary extends Component<
  { children: ReactNode; store: WalletAuthStore; provider?: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // Choosing another provider retries without remounting the SDKs that work.
  componentDidUpdate(previous: { provider?: string }) {
    if (this.state.failed && previous.provider !== this.props.provider)
      this.setState({ failed: false });
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
  const knownProvider =
    authProvider && getWalletProvider(authProvider) ? authProvider : undefined;
  const signIn = useSocialSignIn(store, knownProvider);
  const [sheetChannel] = useState(createSheetChannel);
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
            <SheetChannelContext.Provider value={sheetChannel}>
              <WalletAuthBridge store={store}>
                <SocialSignInOptions signIn={signIn}>
                  {props.children}
                </SocialSignInOptions>
                <SocialLoginOpener signIn={signIn} />
              </WalletAuthBridge>
              {!props.initializing && (
                <WalletIslandErrorBoundary
                  store={store}
                  provider={knownProvider}
                  key={signIn.attempt}
                >
                  <WalletIslands
                    store={store}
                    signIn={signIn}
                    active={knownProvider}
                    account={props.account}
                    auth={auth}
                    unknownProvider={knownProvider ? undefined : authProvider}
                    execution={props.execution}
                    providers={props.providers}
                    wallets={props.wallets}
                  >
                    {null}
                  </WalletIslands>
                </WalletIslandErrorBoundary>
              )}
            </SheetChannelContext.Provider>
          </AomiWalletNetworkPreferencesProvider>
        </ExtUserProvider>
      </FullTestnetConfigContext.Provider>
    </WidgetStorageProvider>
  );
}
