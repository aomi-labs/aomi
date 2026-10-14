"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Environment, TOAuthMethod } from "@getpara/react-sdk";
import type {
  AuthConfig,
  AuthMethodId,
  ProvidersConfig,
} from "@/wallet/config/types";
import {
  registerWalletProvider,
  type WalletProviderPlugin,
} from "@/wallet/providers/plugin-registry";
import { AomiParaPluginProvider } from "./para-plugin-provider";
import { AomiParaEvmRuntimeProvider } from "./para-evm-runtime-provider";
import { defaultOAuthMethods } from "./para-auth";
import { paraSdk } from "./para-sdk";

// Once its connectors load, Para has this long to report ready.
const PARA_STARTUP_TIMEOUT_MS = 4_000;
// Until its connectors load, ParaProvider renders nothing, so a Para that never
// loads (invalid key, outage, blocked script) falls back after this window.
const PARA_LOAD_TIMEOUT_MS = 15_000;

// ParaProvider lazily imports its EVM and Cosmos connector packages on first
// mount and renders nothing until they arrive. Those loading flags live in the
// SDK's page-global store and never reset, so this mirrors them for the page.
let paraConnectorsLoaded = false;

/**
 * Mounts only once ParaProvider renders its children, i.e. after the SDK's
 * connector libraries have loaded. The layout effect lets the host move the
 * app under ParaProvider before the browser paints.
 */
function ParaConnectorsLoaded({ onLoaded }: { onLoaded: () => void }) {
  useLayoutEffect(() => {
    paraConnectorsLoaded = true;
    onLoaded();
  }, [onLoaded]);
  return null;
}

/**
 * Reports startup success from `useParaStatus().isReady`, which turns true only
 * once the Para client's setup succeeds, because a loaded ParaProvider renders
 * its children while initializing and on error too.
 */
function ParaStartupWatcher({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady: () => void;
}) {
  const isReady = Boolean(paraSdk().react.useParaStatus().isReady);
  useEffect(() => {
    if (isReady) onReady();
  }, [isReady, onReady]);
  return <>{children}</>;
}

function toParaEnvironment(value?: "PROD" | "BETA") {
  // Turbopack can emit Para's barrel enum getter with a missing binding.
  return (value ?? "BETA") as Environment;
}

function toParaOAuthMethods(
  methods: readonly AuthMethodId[] | undefined,
): TOAuthMethod[] {
  if (!methods) return defaultOAuthMethods;
  const map = {
    google: "GOOGLE",
    apple: "APPLE",
    discord: "DISCORD",
    x: "TWITTER",
    farcaster: "FARCASTER",
    telegram: "TELEGRAM",
  } as const satisfies Partial<Record<AuthMethodId, TOAuthMethod>>;
  const resolved = methods
    .map((method) => map[method as keyof typeof map])
    .filter((method): method is NonNullable<typeof method> => Boolean(method));
  return resolved.length ? resolved : defaultOAuthMethods;
}

function isParaAuth(auth: AuthConfig | undefined): boolean {
  return auth !== false && auth?.provider === "para";
}

function ParaAuthLayer({
  auth,
  children,
  providers,
  onFailure,
}: {
  auth?: AuthConfig;
  children: ReactNode;
  providers?: ProvidersConfig;
  onFailure?: (message: string | null) => void;
}) {
  const enabled = isParaAuth(auth);
  const [providerReady, setProviderReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [connectorsLoaded, setConnectorsLoaded] = useState(
    () => paraConnectorsLoaded,
  );
  const markConnectorsLoaded = useCallback(() => setConnectorsLoaded(true), []);
  const para = providers?.para === false ? undefined : providers?.para;
  const apiKey = para?.apiKey;
  const paraClientConfig = useMemo(
    () =>
      apiKey
        ? {
            apiKey,
            env: toParaEnvironment(para?.environment),
            opts: para?.disableWorkers ? { disableWorkers: true } : undefined,
          }
        : null,
    [apiKey, para?.disableWorkers, para?.environment],
  );
  const paraConfig = useMemo(
    () => ({
      appName: para?.appName ?? "Aomi",
      disableAutoSessionKeepAlive: true,
    }),
    [para?.appName],
  );
  // Depend on the methods, not the auth object, so a warm SDK keeps its config.
  const methods =
    enabled && auth !== false && auth?.provider === "para"
      ? auth.methods
      : undefined;
  const paraModalConfig = useMemo(
    () => ({
      disableEmailLogin: false,
      oAuthMethods: toParaOAuthMethods(methods),
    }),
    [methods],
  );
  const externalWalletConfig = useMemo(
    () => ({
      appDescription: para?.appDescription ?? "Aomi widget",
      appUrl:
        para?.appUrl ??
        (typeof window !== "undefined"
          ? window.location.origin
          : "https://aomi.dev"),
      wallets: [],
      walletConnect: undefined,
    }),
    [para?.appDescription, para?.appUrl],
  );
  const markProviderReady = useCallback(() => {
    setProviderReady(true);
    setTimedOut(false);
    onFailure?.(null);
  }, [onFailure]);
  // The watchdog allows the load window until the connectors arrive and the
  // startup window after. The kit shows the failure inside the widget and
  // remounts this layer when the user chooses Para again.
  useEffect(() => {
    if (!enabled || !paraClientConfig || providerReady) {
      return;
    }
    const timeout = window.setTimeout(
      () => {
        setTimedOut(true);
        onFailure?.(
          "Para could not start. Check the API key environment and allowed browser origin, then choose Para again.",
        );
      },
      connectorsLoaded ? PARA_STARTUP_TIMEOUT_MS : PARA_LOAD_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [enabled, paraClientConfig, connectorsLoaded, providerReady, onFailure]);

  // A Para that never loads leaves browser wallets usable without it.
  if (!enabled || !paraClientConfig || (timedOut && !connectorsLoaded)) {
    return <>{children}</>;
  }

  // Mount the wallet runtimes (`children`) only under ParaProvider once its
  // connector libraries arrive: mounting them first would run wagmi's
  // reconnect in a config that is then thrown away, and wagmi skips the real
  // config's reconnect while that one is in flight.
  const { ParaProvider } = paraSdk().react;
  return (
    <ParaProvider
      paraClientConfig={paraClientConfig}
      config={paraConfig}
      paraModalConfig={paraModalConfig}
      externalWalletConfig={externalWalletConfig}
    >
      {connectorsLoaded ? (
        <ParaStartupWatcher onReady={markProviderReady}>
          {children}
        </ParaStartupWatcher>
      ) : (
        <ParaConnectorsLoaded onLoaded={markConnectorsLoaded} />
      )}
    </ParaProvider>
  );
}

export const paraPlugin: WalletProviderPlugin = {
  id: "para",
  authMode: "additive",
  isAvailable: ({ auth, providers }) => {
    const enabled = isParaAuth(auth);
    const para = providers?.para === false ? undefined : providers?.para;
    return Boolean(enabled && para?.apiKey);
  },
  wrap: (props) => <ParaAuthLayer {...props} />,
  renderEvmRuntimeProvider: (props) => (
    <AomiParaEvmRuntimeProvider {...props} />
  ),
  renderComposer: ({
    account,
    auth,
    children,
    execution,
    externalSvmWallet,
    selectedSolanaNetwork,
    setSelectedSolanaNetworkId,
    solanaRuntimeConfig,
    supportedChains,
    supportedSolanaNetworks,
  }) => (
    <AomiParaPluginProvider
      account={account}
      execution={execution}
      externalSvmWallet={externalSvmWallet}
      oAuthMethods={toParaOAuthMethods(
        auth !== false && auth?.provider === "para" ? auth.methods : undefined,
      )}
      selectedSolanaNetwork={selectedSolanaNetwork}
      setSelectedSolanaNetworkId={setSelectedSolanaNetworkId}
      supportedChains={supportedChains}
      supportedSolanaNetworks={supportedSolanaNetworks}
      svmConfig={solanaRuntimeConfig}
    >
      {children}
    </AomiParaPluginProvider>
  ),
  detectSugar: (input) => {
    if (
      input.auth !== false &&
      input.auth?.provider === "para" &&
      "apiKey" in input.auth
    ) {
      return {
        children: input.children,
        providers: {
          para: {
            apiKey: input.auth.apiKey,
            environment: input.auth.environment,
            appName: input.auth.appName,
            appDescription: input.auth.appDescription,
            disableWorkers: input.auth.disableWorkers,
          },
        },
        auth: { provider: "para", methods: input.auth.methods },
      };
    }
    return null;
  },
};

export function registerAomiParaWalletProvider(): void {
  registerWalletProvider(paraPlugin);
}
