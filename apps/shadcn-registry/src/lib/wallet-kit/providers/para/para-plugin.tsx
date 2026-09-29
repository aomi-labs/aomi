"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Environment,
  ParaProvider,
  useParaStatus,
  type TOAuthMethod,
} from "@getpara/react-sdk";
import "@getpara/react-sdk/styles.css";
import type {
  AuthConfig,
  AuthMethodId,
  ProvidersConfig,
} from "../../config/types";
import {
  registerWalletProvider,
  type WalletProviderPlugin,
} from "../plugin-registry";
import { AomiParaPluginProvider } from "./ParaPluginProvider";
import { AomiParaEvmRuntimeProvider } from "./para-evm-runtime-provider";
import { defaultOAuthMethods } from "./para-auth";
import { safeEnv } from "../../env";

const PARA_STARTUP_TIMEOUT_MS = 4_000;

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
 * Defensive read of the Para SDK readiness signal, mirroring the other
 * `useSafe*` Para hooks: `useParaStatus()` throws if no Para context is mounted,
 * which we treat as "not ready".
 */
function useSafeParaReady(): boolean {
  try {
    return Boolean(useParaStatus().isReady);
  } catch {
    return false;
  }
}

/**
 * Reports Para startup success from the SDK's real readiness signal rather than
 * from "children mounted".
 *
 * `useParaStatus().isReady` flips true only after the Para client's first-time
 * setup succeeds and stays false on startup failure — the true success/error
 * discriminator. Because `ParaProvider` renders its children even while
 * initializing (and even on error), keying readiness off "children rendered"
 * (the previous approach) fired `onReady` on failure too, wrongly suppressing
 * the startup banner. Gating on `isReady` fixes that direction.
 *
 * It also fixes the effect-ordering bug: child effects commit before the
 * parent's on mount. Since `isReady` starts false, this watcher does NOT call
 * `onReady` during the initial commit, so the parent's watchdog effect can no
 * longer be clobbered by (and then re-clobber) a ready flag set from a child.
 * `onReady` only fires later, on the async `isReady` false→true transition.
 */
function ParaStartupWatcher({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady: () => void;
}) {
  const isReady = useSafeParaReady();
  useEffect(() => {
    if (isReady) onReady();
  }, [isReady, onReady]);
  return <>{children}</>;
}

function toParaEnvironment(value?: "PROD" | "BETA") {
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
  const apiKey =
    para?.apiKey ?? safeEnv(() => process.env.NEXT_PUBLIC_PARA_API_KEY);
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
  // Called from ParaStartupWatcher once the SDK actually reports ready. Setting
  // `providerReady` also disarms the watchdog effect below (via its deps), so a
  // slow-but-successful startup never leaves the banner up, and any banner
  // already shown is cleared.
  const markProviderReady = useCallback(() => {
    setProviderReady(true);
    setStartupTimedOut(false);
  }, []);
  // Retry owns the state reset so a fresh attempt starts from a clean slate:
  // clear ready/timeout here (never inside the watchdog effect, whose mount-time
  // reset used to clobber a ready flag a child had just set) and bump the
  // attempt to remount ParaProvider via its `key`.
  const retryStartup = useCallback(() => {
    setProviderReady(false);
    setStartupTimedOut(false);
    setStartupAttempt((attempt) => attempt + 1);
  }, []);
  // Arm a one-shot watchdog while we are waiting for a startup attempt that is
  // not yet ready. It only raises the timed-out flag; it never sets
  // `providerReady`, so it cannot race the child that reports readiness. Because
  // `providerReady` is a dependency, flipping ready runs the cleanup (clearing
  // the pending timer) and then bails — even in the edge case where the child's
  // ready effect commits before this parent effect on mount.
  // Connector download time is not a startup failure, so the watchdog arms only
  // once the libraries are in.
  useEffect(() => {
    if (!enabled || !paraClientConfig || !connectorsLoaded || providerReady) {
      return;
    }
    const timeout = window.setTimeout(
      () => setStartupTimedOut(true),
      PARA_STARTUP_TIMEOUT_MS,
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

  if (startupTimedOut && !providerReady) {
    return (
      <>
        <div
          role="alert"
          className="border-destructive/25 bg-destructive/10 text-destructive mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
        >
          <span>
            Para authentication could not start. Check the API key environment
            and allowed browser origin.
          </span>
          <button
            type="button"
            onClick={retryStartup}
            className="cursor-pointer rounded-md border border-current px-2.5 py-1.5 text-inherit"
          >
            Retry
          </button>
        </div>
        {children}
      </>
    );
  }

  // Until the connector libraries load, ParaProvider renders nothing, and it
  // wraps the whole host app. Keep the app on screen beside it (Para hooks here
  // are all context-safe) and move it under ParaProvider once they arrive. The
  // fixed slots keep the ParaProvider instance stable across that move.
  return (
    <>
      {connectorsLoaded ? null : children}
      <ParaProvider
        key={startupAttempt}
        paraClientConfig={paraClientConfig}
        config={paraConfig}
        paraModalConfig={paraModalConfig}
        externalWalletConfig={externalWalletConfig}
      >
        {/*
          Readiness is owned by ParaStartupWatcher, which reads the SDK's real
          `useParaStatus().isReady` signal. This is correct whether or not the SDK
          gates children on readiness: if it renders children early, the watcher
          mounts and waits for the isReady false→true transition; if it renders
          them only once ready, the watcher mounts already-ready. On error isReady
          stays false, so onReady never fires and the watchdog shows the banner.
        */}
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
    return Boolean(
      enabled &&
      (para?.apiKey ?? safeEnv(() => process.env.NEXT_PUBLIC_PARA_API_KEY)),
    );
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

registerAomiParaWalletProvider();
