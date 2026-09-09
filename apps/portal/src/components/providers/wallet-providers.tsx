"use client";

import "@aomi-labs/widget-lib/providers/para";
import "@aomi-labs/widget-lib/providers/privy";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  mainnet,
  arbitrum,
  optimism,
  base,
  baseSepolia,
  polygon,
  sepolia,
  linea,
  lineaSepolia,
} from "wagmi/chains";
import { type Chain } from "viem";
import {
  AomiWalletKitProvider,
  ExtUserProvider,
  FullTestnetWalletRouter,
  arcTestnet,
  monad,
  monadTestnet,
  megaeth,
  robinhood,
  useFullTestnet,
  useAomiWalletKit,
  WalletSignInOptionsContext,
} from "@aomi-labs/widget-lib";
import { PrivyDelegationProvider } from "@aomi-labs/widget-lib/providers/privy";
import {
  E2EWalletProvider,
  type E2EWalletSeedClient,
} from "@portal/components/providers/e2e-wallet-provider";
import {
  isDeviceAuthRoute,
  classifyProviderInitializationFailure,
  providerConfigurationFailure,
  providerFailureText,
  requestedDeviceAuthProvider,
  type DeviceAuthProvider,
} from "@portal/lib/device-auth-provider";

const paraApiKey = process.env.NEXT_PUBLIC_PARA_API_KEY?.trim() ?? "";
const paraEnvironmentSetting =
  process.env.NEXT_PUBLIC_PARA_ENVIRONMENT?.trim() ?? "";
const paraEnvironment = paraEnvironmentSetting === "PROD" ? "PROD" : "BETA";
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_PROJECT_ID?.trim() ||
  "";

const defaultNetworks = [
  mainnet,
  arbitrum,
  optimism,
  base,
  baseSepolia,
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

export const networks = [...defaultNetworks] as readonly [Chain, ...Chain[]];

const solanaNetworks = [
  {
    id: "solana-devnet",
    label: "Solana Devnet",
    cluster: "solana:devnet",
    rpcHttpUrl:
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "https://api.devnet.solana.com",
    rpcWsUrl:
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_WS_URL ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_WS_URL,
  },
  {
    id: "solana-mainnet",
    label: "Solana",
    cluster: "solana:mainnet",
    rpcHttpUrl:
      process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ??
      // The official public endpoint rejects localhost browser origins with
      // HTTP 403. Keep the zero-config portal fallback browser-compatible so
      // wallet approval can refresh and broadcast the signed transaction.
      "https://solana-rpc.publicnode.com",
    rpcWsUrl: process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_WS_URL,
    isDefault: true,
  },
  {
    id: "solana-testnet",
    label: "Solana Testnet",
    cluster: "solana:testnet",
    rpcHttpUrl:
      process.env.NEXT_PUBLIC_SOLANA_TESTNET_RPC_URL ??
      "https://api.testnet.solana.com",
    rpcWsUrl: process.env.NEXT_PUBLIC_SOLANA_TESTNET_RPC_WS_URL,
  },
] as const;

type Props = {
  children: ReactNode;
  cookies?: string | null;
  e2eWallet?: E2EWalletSeedClient | null;
};

type BrowserAuthOrigin = {
  authDomain: string;
  authUri: string;
};

function getBrowserAuthOrigin(): BrowserAuthOrigin | null {
  if (typeof window === "undefined") return null;
  return {
    authDomain: window.location.host,
    authUri: window.location.origin,
  };
}

export function WalletProviders({ children, e2eWallet }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [signIn, setSignIn] = useState<{
    provider: DeviceAuthProvider;
    attempt: number;
  } | null>(null);
  const [providerRestored, setProviderRestored] = useState(false);
  useEffect(() => {
    try {
      const provider = window.localStorage.getItem("aomi:wallet-provider");
      if (
        (provider === "para" && paraApiKey) ||
        (provider === "privy" && privyAppId)
      ) {
        setSignIn({ provider, attempt: 0 });
      }
    } catch {
      // Storage can be disabled; provider selection still works for this visit.
    } finally {
      setProviderRestored(true);
    }
  }, []);
  const chooseProvider = useCallback(async (provider: DeviceAuthProvider) => {
    try {
      window.localStorage.setItem("aomi:wallet-provider", provider);
    } catch {
      // Remembering a UI preference is optional, never an authentication grant.
    }
    setSignIn((previous) => ({
      provider,
      attempt: (previous?.attempt ?? 0) + 1,
    }));
  }, []);
  const signInOptions = useMemo(() => {
    const providers: DeviceAuthProvider[] = [];
    if (privyAppId) providers.push("privy");
    if (paraApiKey) providers.push("para");
    return providers.map((provider) => ({
      id: provider,
      label: provider === "privy" ? "Privy" : "Para",
      description: "Sign in or link this provider to your Aomi account",
      family: "multichain" as const,
      kind: "social" as const,
      status: "available" as const,
      connect: () => chooseProvider(provider),
    }));
  }, [chooseProvider]);
  const [browserAuthOrigin, setBrowserAuthOrigin] =
    useState<BrowserAuthOrigin | null>(() => getBrowserAuthOrigin());
  useEffect(() => {
    setBrowserAuthOrigin(getBrowserAuthOrigin());
  }, []);
  // Keeps the real chain ids (1, 8453, ...) and swaps only the RPC url, so the
  // UI still reads "Ethereum · Mainnet" while transactions hit a local fork.
  // Inert unless NEXT_PUBLIC_USE_FULL_TESTNET=true and the RPC map parses.
  const {
    enabled: fullTestnetEnabled,
    routedChains,
    routedChainIds,
  } = useFullTestnet(networks);
  const account = useMemo(
    () => ({
      mode: "aomi-backend" as const,
      ...(browserAuthOrigin ?? {}),
    }),
    [browserAuthOrigin],
  );
  const evmWallets =
    typeof window !== "undefined" && walletConnectProjectId
      ? (["metamask", "rabby", "coinbase", "walletconnect"] as const)
      : (["metamask", "rabby", "coinbase"] as const);
  const routeProvider = requestedDeviceAuthProvider(pathname, searchParams);
  const routeProviderFailure = routeProvider
    ? providerConfigurationFailure(routeProvider, {
        paraApiKey,
        paraEnvironment: paraEnvironmentSetting,
        privyAppId,
      })
    : null;
  const selectedProvider = isDeviceAuthRoute(pathname)
    ? routeProviderFailure
      ? null
      : routeProvider
    : (signIn?.provider ?? (privyAppId ? "privy" : paraApiKey ? "para" : null));
  const auth = selectedProvider
    ? selectedProvider === "privy"
      ? ({ provider: "privy" } as const)
      : ({ provider: "para", methods: ["email", "google"] } as const)
    : false;

  if (e2eWallet) {
    return (
      <E2EWalletProvider
        seed={e2eWallet}
        networks={routedChains}
        solanaNetworks={solanaNetworks}
      >
        {children}
      </E2EWalletProvider>
    );
  }

  const routedChildren = (
    <FullTestnetWalletRouter
      enabled={fullTestnetEnabled}
      chains={routedChains}
      routedChainIds={routedChainIds}
      logLabel="portal:FullTestnetWalletRouter"
    >
      {children}
    </FullTestnetWalletRouter>
  );
  const providerTree = (
    <WalletSignInOptionsContext.Provider
      value={
        !providerRestored || isDeviceAuthRoute(pathname) ? [] : signInOptions
      }
    >
      <AomiWalletKitProvider
        initializing={!providerRestored}
        auth={auth}
        account={account}
        providers={{
          para: paraApiKey
            ? {
                appName: "Aomi Labs",
                appDescription: "Aomi portal testing",
                apiKey: paraApiKey,
                environment: paraEnvironment,
              }
            : false,
          privy: privyAppId
            ? {
                appId: privyAppId,
                appName: "Aomi Labs",
              }
            : false,
        }}
        wallets={{
          evm: {
            chains: routedChains,
            appName: "Aomi Labs",
            wallets: evmWallets,
            walletConnectProjectId,
          },
          solana: {
            networks: solanaNetworks,
            preferDirectSend: true,
          },
        }}
      >
        {providerRestored &&
          !isDeviceAuthRoute(pathname) &&
          signIn &&
          signIn.attempt > 0 && (
            <ProviderSignIn key={signIn.attempt} provider={signIn.provider} />
          )}
        {!providerRestored ? (
          children
        ) : selectedProvider === "privy" ? (
          <PrivyDelegationProvider>{routedChildren}</PrivyDelegationProvider>
        ) : (
          routedChildren
        )}
      </AomiWalletKitProvider>
    </WalletSignInOptionsContext.Provider>
  );
  const mounted =
    isDeviceAuthRoute(pathname) && selectedProvider ? (
      <DeviceAuthProviderErrorBoundary
        key={`${pathname}:${selectedProvider}`}
        provider={selectedProvider}
      >
        {providerTree}
      </DeviceAuthProviderErrorBoundary>
    ) : (
      providerTree
    );
  // Keep account state above the route-keyed device-auth error boundary.
  return <ExtUserProvider>{mounted}</ExtUserProvider>;
}

function ProviderSignIn({ provider }: { provider: DeviceAuthProvider }) {
  const adapter = useAomiWalletKit();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!adapter.isReady || !adapter.connectSocial || started.current) return;
    started.current = true;
    void adapter.connectSocial(provider).catch(() => setFailed(true));
  }, [adapter, provider]);
  return failed ? (
    <div
      role="alert"
      className="bg-background fixed bottom-4 right-4 z-[100] rounded-xl p-4 shadow-lg"
    >
      Couldn’t open {provider === "privy" ? "Privy" : "Para"}. Choose it again
      to retry.
    </div>
  ) : null;
}

class DeviceAuthProviderErrorBoundary extends Component<
  { children: ReactNode; provider: DeviceAuthProvider },
  { error: unknown | null }
> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    const failure = classifyProviderInitializationFailure(
      this.props.provider,
      error,
      providerConfiguration,
    );
    console.error("device_auth_provider_initialization_failed", {
      provider: this.props.provider,
      code: failure.code,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const failure = classifyProviderInitializationFailure(
      this.props.provider,
      this.state.error,
      providerConfiguration,
    );
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
        <section className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in to Aomi CLI
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            {providerFailureText(failure)}
          </p>
        </section>
      </main>
    );
  }
}

const providerConfiguration = {
  paraApiKey,
  paraEnvironment: paraEnvironmentSetting,
  privyAppId,
};
