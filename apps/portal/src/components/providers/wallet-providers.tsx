"use client";

import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from "react";
import { hostedPortalOrigin, hostedPortalApiOrigin } from "@/lib/hosted-portal";
import {
  arc,
  arcTestnet,
  createScopedStorage,
  megaeth,
  monad,
  monadTestnet,
  robinhood,
} from "@aomi-labs/client";
import { ExtUserProvider } from "@aomi-labs/react";
import { usePathname, useSearchParams } from "@/lib/navigation";
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
  parseRpcOverrides,
  ShellTransportProvider,
  useAomiWalletKit,
  useFullTestnet,
  WalletSignInOptionsContext,
} from "@aomi-labs/widget/host-composition";
import {
  E2EWalletProvider,
  type E2EWalletSeedClient,
} from "@/components/providers/e2e-wallet-provider";
import {
  isDeviceAuthRoute,
  classifyProviderInitializationFailure,
  providerConfigurationFailure,
  providerFailureText,
  requestedDeviceAuthProvider,
  type DeviceAuthProvider,
} from "@/lib/device-auth-provider";

const paraApiKey = process.env.NEXT_PUBLIC_PARA_API_KEY?.trim() ?? "";
const paraEnvironmentSetting =
  process.env.NEXT_PUBLIC_PARA_ENVIRONMENT?.trim() ?? "";
const paraEnvironment: "PROD" | "BETA" =
  paraEnvironmentSetting === "PROD" ? "PROD" : "BETA";
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_PROJECT_ID?.trim() ||
  "";

const fullTestnet =
  process.env.NEXT_PUBLIC_USE_FULL_TESTNET === "true"
    ? {
        rpcMap: parseRpcOverrides(
          process.env.NEXT_PUBLIC_FULL_TESTNET_RPC_MAP ?? "",
        ),
      }
    : undefined;

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
  arc,
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
  const applicationId =
    searchParams.get("application_id") ??
    searchParams.get("applicationId") ??
    "portal";
  const preferenceStorage = useMemo(
    () =>
      createScopedStorage({
        backendUrl:
          typeof window === "undefined" ? "/" : window.location.origin,
        appId: applicationId,
      }),
    [applicationId],
  );
  const [signInProvider, setSignInProvider] =
    useState<DeviceAuthProvider | null>(null);
  const [providerRestored, setProviderRestored] = useState(false);
  useEffect(() => {
    try {
      const provider = preferenceStorage.migrate(
        "walletProvider",
        "aomi:wallet-provider",
      );
      if (
        (provider === "para" && paraApiKey) ||
        (provider === "privy" && privyAppId)
      ) {
        setSignInProvider(provider);
      }
    } catch {
      // Storage can be disabled; provider selection still works for this visit.
    } finally {
      setProviderRestored(true);
    }
  }, [preferenceStorage]);
  const chooseProvider = useCallback(
    async (provider: DeviceAuthProvider) => {
      try {
        preferenceStorage.set("walletProvider", provider);
      } catch {
        // Remembering a UI preference is optional, never an authentication grant.
      }
      setSignInProvider(provider);
    },
    [preferenceStorage],
  );
  const signInOptions = useMemo(() => {
    const providers: DeviceAuthProvider[] = [];
    if (privyAppId) providers.push("privy");
    if (paraApiKey) providers.push("para");
    return providers.map((provider) => ({
      id: provider,
      label: provider === "privy" ? "Privy" : "Para",
      description:
        provider === "privy" ? "Email, Google, X or Apple" : "Email or passkey",
      family: "multichain" as const,
      kind: "social" as const,
      status: "available" as const,
      // Only records the choice: the wallet kit opens the provider's login.
      connect: () => chooseProvider(provider),
    }));
  }, [chooseProvider]);
  const [browserAuthOrigin, setBrowserAuthOrigin] =
    useState<BrowserAuthOrigin | null>(() => getBrowserAuthOrigin());
  useEffect(() => {
    const origin = getBrowserAuthOrigin();
    setBrowserAuthOrigin((previous) =>
      previous?.authDomain === origin?.authDomain &&
      previous?.authUri === origin?.authUri
        ? previous
        : origin,
    );
  }, []);
  // Keeps the real chain ids (1, 8453, ...) and swaps only the RPC url, so the
  // UI still reads "Ethereum · Mainnet" while transactions hit a local fork.
  // Inert unless NEXT_PUBLIC_USE_FULL_TESTNET=true and the RPC map parses.
  const { routedChains } = useFullTestnet(networks, fullTestnet);
  const hostedOrigin = hostedPortalOrigin();
  const account = useMemo(
    () => ({
      mode: "aomi-backend" as const,
      ...(hostedOrigin
        ? {
            baseUrl: hostedPortalApiOrigin(),
            widgetAuth: { mode: "wallet" as const },
          }
        : (browserAuthOrigin ?? {})),
    }),
    [browserAuthOrigin, hostedOrigin],
  );
  const evmWallets = useMemo(
    () =>
      typeof window !== "undefined" && walletConnectProjectId
        ? (["metamask", "rabby", "coinbase", "walletconnect"] as const)
        : (["metamask", "rabby", "coinbase"] as const),
    [],
  );
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
    : signInProvider;
  const auth = useMemo(
    () =>
      selectedProvider
        ? selectedProvider === "privy"
          ? ({ provider: "privy" } as const)
          : ({ provider: "para", methods: ["email", "google"] } as const)
        : false,
    [selectedProvider],
  );
  const providers = useMemo(
    () =>
      ({
        para: paraApiKey
          ? {
              appName: "Aomi Labs",
              appDescription: "Aomi portal testing",
              apiKey: paraApiKey,
              environment: paraEnvironment,
            }
          : false,
        privy: privyAppId ? { appId: privyAppId, appName: "Aomi Labs" } : false,
      }) as const,
    [],
  );
  // Route updates must not recreate the provider's Wagmi configuration and
  // discard the currently connected signer. Actual chain routing stays reactive.
  const wallets = useMemo(
    () => ({
      evm: {
        chains: routedChains,
        appName: "Aomi Labs",
        wallets: evmWallets,
        walletConnectProjectId,
      },
      solana: { networks: solanaNetworks, preferDirectSend: true },
    }),
    [routedChains, evmWallets],
  );

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
    <WalletSignInOptionsContext.Provider
      value={
        !providerRestored || isDeviceAuthRoute(pathname) || hostedOrigin
          ? []
          : signInOptions
      }
    >
      <AomiWalletKitProvider
        fullTestnet={fullTestnet}
        initializing={!providerRestored}
        auth={hostedOrigin ? false : auth}
        account={account}
        providers={providers}
        wallets={wallets}
      >
        <HostedPortalShell>{children}</HostedPortalShell>
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

function HostedPortalShell({ children }: { children: ReactNode }) {
  const origin = hostedPortalOrigin();
  const kit = useAomiWalletKit();
  if (!origin) return <>{children}</>;
  return (
    <ShellTransportProvider
      baseUrl={hostedPortalApiOrigin()}
      getBearer={kit.getAccountBearer}
    >
      {children}
    </ShellTransportProvider>
  );
}
