"use client";

import "@aomi-labs/widget-lib/providers/para";
import "@aomi-labs/widget-lib/providers/privy";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useMemo,
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
  FullTestnetWalletRouter,
  arcTestnet,
  monad,
  monadTestnet,
  megaeth,
  robinhood,
  useFullTestnet,
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
    : privyAppId
      ? "privy"
      : paraApiKey
        ? "para"
        : null;
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

  const providerTree = (
    <AomiWalletKitProvider
      key={selectedProvider ?? "no-auth-provider"}
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
      {selectedProvider === "privy" ? (
        <PrivyDelegationProvider>
          <FullTestnetWalletRouter
            enabled={fullTestnetEnabled}
            chains={routedChains}
            routedChainIds={routedChainIds}
            logLabel="portal:FullTestnetWalletRouter"
          >
            {children}
          </FullTestnetWalletRouter>
        </PrivyDelegationProvider>
      ) : (
        <FullTestnetWalletRouter
          enabled={fullTestnetEnabled}
          chains={routedChains}
          routedChainIds={routedChainIds}
          logLabel="portal:FullTestnetWalletRouter"
        >
          {children}
        </FullTestnetWalletRouter>
      )}
    </AomiWalletKitProvider>
  );
  return isDeviceAuthRoute(pathname) && selectedProvider ? (
    <DeviceAuthProviderErrorBoundary
      key={`${pathname}:${selectedProvider}`}
      provider={selectedProvider}
    >
      {providerTree}
    </DeviceAuthProviderErrorBoundary>
  ) : (
    providerTree
  );
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
