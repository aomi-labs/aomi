"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TOAuthMethod } from "@getpara/react-sdk";
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
  const { Environment } = paraSdk().react;
  if (!value) return Environment.BETA;
  return value === "PROD" ? Environment.PROD : Environment.BETA;
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
}: {
  auth?: AuthConfig;
  children: ReactNode;
  providers?: ProvidersConfig;
}) {
  const enabled = isParaAuth(auth);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [startupTimedOut, setStartupTimedOut] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
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
  const paraModalConfig = useMemo(
    () => ({
      disableEmailLogin: false,
      oAuthMethods: toParaOAuthMethods(
        enabled && auth !== false && auth?.provider === "para"
          ? auth.methods
          : undefined,
      ),
    }),
    [auth, enabled],
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
  // Readiness disarms the watchdog and clears a banner already shown.
  const markProviderReady = useCallback(() => {
    setProviderReady(true);
    setStartupTimedOut(false);
  }, []);
  // Retry clears ready and timeout state and remounts ParaProvider via its key.
  const retryStartup = useCallback(() => {
    setProviderReady(false);
    setStartupTimedOut(false);
    setStartupAttempt((attempt) => attempt + 1);
  }, []);
  // The watchdog only raises the timed-out flag, allowing the load window until
  // the connectors arrive and the startup window after.
  useEffect(() => {
    if (!enabled || !paraClientConfig || providerReady) {
      return;
    }
    const timeout = window.setTimeout(
      () => setStartupTimedOut(true),
      connectorsLoaded ? PARA_STARTUP_TIMEOUT_MS : PARA_LOAD_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [
    enabled,
    paraClientConfig,
    connectorsLoaded,
    startupAttempt,
    providerReady,
  ]);

  if (!enabled || !paraClientConfig) {
    return <>{children}</>;
  }

  const startupBanner =
    startupTimedOut && !providerReady ? (
      <div
        role="alert"
        className="border-destructive/25 bg-destructive/10 text-destructive mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
      >
        <span>
          Para authentication could not start. Check the API key environment and
          allowed browser origin.
        </span>
        <button
          type="button"
          onClick={retryStartup}
          className="cursor-pointer rounded-md border border-current px-2.5 py-1.5 text-inherit"
        >
          Retry
        </button>
      </div>
    ) : null;

  if (startupBanner && !connectorsLoaded) {
    return (
      <>
        {startupBanner}
        {children}
      </>
    );
  }

  // Mount the wallet runtimes (`children`) only under ParaProvider once its
  // connector libraries arrive: mounting them first would run wagmi's
  // reconnect in a config that is then thrown away, and wagmi skips the real
  // config's reconnect while that one is in flight.
  const { ParaProvider } = paraSdk().react;
  return (
    <>
      {startupBanner}
      <ParaProvider
        key={startupAttempt}
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
    </>
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
