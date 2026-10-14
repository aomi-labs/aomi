"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { WidgetShell, type AomiWidgetFeatures } from "./widget-shell";
import { ShellTransportProvider } from "@/account/transport";
import type { WalletAccountMenuOptions } from "@/account/account-menu-types";
export type { AomiWidgetFeatures } from "./widget-shell";
export {
  paraAuth,
  privyAuth,
  type AomiWidgetAuth,
  type CrossOriginWidgetAuth,
  type ParaAuthOptions,
  type PrivyAuthOptions,
} from "./widget-auth";
import type {
  AomiClientOptions,
  AomiInferenceFundingSource,
} from "@aomi-labs/react";
import { createWidgetX402Client } from "@/wallet/payment-client";
import { SvmWalletBindingGate } from "@/wallet/svm-wallet-binding-gate";
import { AomiFrame, type AomiFrameControlBarProps } from "./aomi-frame";
import { AomiWalletKitProvider } from "@/wallet/config/aomi-wallet-kit-provider";
import { useAomiWalletKit } from "@/wallet/context";
import type { WalletsConfig } from "@/wallet/config/types";
import { cn } from "@aomi-labs/react";
import {
  resolveWidgetAuth,
  type AomiWidgetAuth,
  type ResolvedWidgetAuth,
} from "./widget-auth";
import {
  normalizeAomiRouting,
  toAgentTarget,
  type AomiRoutingConfig,
} from "@/controls/routing";

export type WalletPresentationConfig = WalletsConfig;

export type AomiWidgetTheme = "light" | "dark" | "system";

export type AomiWidgetProps = {
  children?: ReactNode;
  /** The hosted App's Application ID; scopes threads and sign-in state. */
  applicationId: string | number;
  /** Aomi backend origin. Defaults to https://chat.aomi.dev. */
  baseUrl?: string;
  /** @deprecated Use baseUrl. Removed in @aomi-labs/widget 4.0. */
  apiUrl?: string;
  /** Color theme. "system" follows the visitor's OS setting. Defaults to "system". */
  theme?: AomiWidgetTheme;
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
  style?: CSSProperties;
  walletPosition?: "header" | "footer" | null;
  walletFamilies?: Array<"evm" | "solana">;
  showSidebar?: boolean;
  showHeader?: boolean;
  /** Portal controls enabled by default; account management remains available. */
  features?: AomiWidgetFeatures;
  controlBarProps?: Omit<AomiFrameControlBarProps, "children">;
  /** Execution modes and Direct apps available in this widget. Defaults to Auto only. */
  routing?: AomiRoutingConfig;
  clientOptions?: Omit<AomiClientOptions, "baseUrl" | "getAccountBearer">;
  /** Select the account's saved BYOK key for Agent turns. */
  inferenceFunding?: AomiInferenceFundingSource;
  persistThread?: boolean;
  threadPersistenceKey?: string;
  threadPersistenceScope?: string | null;
  initialThreadId?: string;
  /** Controlled thread selection; undefined keeps selection internal. */
  threadId?: string;
  /** Fired once for each user-initiated materialized thread change. */
  onThreadChange?: (threadId: string) => void;
  /** Sign-in provider. Defaults to the visitor's browser wallet. */
  auth?: AomiWidgetAuth;
  wallets?: WalletPresentationConfig;
};

const DEFAULT_BASE_URL = "https://chat.aomi.dev";
const THEMES: readonly AomiWidgetTheme[] = ["light", "dark", "system"];

type WidgetConfig =
  | { error: string }
  | {
      applicationId: string;
      baseUrl: string;
      resolved: ResolvedWidgetAuth;
    };

/** Validate props at the edge so a host mistake reads as a message, not a crash. */
function resolveWidgetConfig(props: AomiWidgetProps): WidgetConfig {
  const applicationId =
    typeof props.applicationId === "number"
      ? String(props.applicationId)
      : props.applicationId;
  if (typeof applicationId !== "string" || !applicationId.trim())
    return {
      error:
        'applicationId is required: pass your hosted App\'s Application ID, e.g. <AomiWidget applicationId="123" />.',
    };
  const baseUrl = (props.baseUrl ?? props.apiUrl ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  if (!/^https?:\/\/[^/]/.test(baseUrl) || !URL.canParse(baseUrl))
    return {
      error: `baseUrl must be an absolute http(s) URL; got ${JSON.stringify(baseUrl)}.`,
    };
  if (props.theme !== undefined && !THEMES.includes(props.theme))
    return {
      error: `theme must be "light", "dark" or "system"; got ${JSON.stringify(props.theme)}.`,
    };
  const resolved = resolveWidgetAuth(props.auth);
  if ("error" in resolved) return resolved;
  return { applicationId, baseUrl, resolved };
}

function WidgetConfigError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  useEffect(() => console.error(`[aomi] ${message}`), [message]);
  return (
    <div
      role="alert"
      className={cn(
        "aomi-widget border-destructive/25 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm",
        className,
      )}
    >
      {message}
    </div>
  );
}

const darkQuery = "(prefers-color-scheme: dark)";
function subscribeColorScheme(onChange: () => void) {
  const query = window.matchMedia?.(darkQuery);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** The theme class for the widget root; "system" tracks the OS setting. */
function useThemeClass(theme: AomiWidgetTheme): "light" | "dark" {
  const systemDark = useSyncExternalStore(
    subscribeColorScheme,
    () => window.matchMedia?.(darkQuery).matches ?? false,
    () => false,
  );
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

export function AomiWidget(props: AomiWidgetProps) {
  const { applicationId, baseUrl, apiUrl, theme } = props;
  // Hosts usually build auth inline (auth={privyAuth(…)}); key it by value so
  // a re-render does not restart the wallet island.
  const authKey = JSON.stringify(props.auth ?? null);
  const config = useMemo(
    () =>
      resolveWidgetConfig({
        applicationId,
        baseUrl,
        apiUrl,
        theme,
        auth: JSON.parse(authKey) ?? undefined,
      }),
    [applicationId, baseUrl, apiUrl, theme, authKey],
  );
  if ("error" in config)
    return (
      <WidgetConfigError message={config.error} className={props.className} />
    );
  return <ConfiguredWidget {...props} {...config} />;
}

function ConfiguredWidget({
  applicationId,
  baseUrl,
  resolved,
  ...props
}: AomiWidgetProps & Exclude<WidgetConfig, { error: string }>) {
  const { auth, providers, widgetAuth } = resolved;
  const account = useMemo(
    () => ({ mode: "aomi-backend" as const, baseUrl, widgetAuth }),
    [baseUrl, widgetAuth],
  );
  const themeClass = useThemeClass(props.theme ?? "system");

  return (
    <AomiWalletKitProvider
      applicationId={applicationId}
      auth={auth}
      providers={providers}
      wallets={props.wallets}
      execution={{ aa: "off", sponsorship: { mode: "disabled" } }}
      account={account}
    >
      <WidgetFrame
        baseUrl={baseUrl}
        applicationId={applicationId}
        width={props.width}
        height={props.height}
        className={cn(themeClass, props.className)}
        style={props.style}
        walletPosition={props.walletPosition}
        walletFamilies={props.walletFamilies}
        showSidebar={props.showSidebar}
        showHeader={props.showHeader}
        features={props.features}
        controlBarProps={props.controlBarProps}
        routing={props.routing}
        clientOptions={props.clientOptions}
        inferenceFunding={props.inferenceFunding}
        persistThread={props.persistThread}
        threadPersistenceKey={props.threadPersistenceKey}
        threadPersistenceScope={props.threadPersistenceScope}
        initialThreadId={props.initialThreadId}
        threadId={props.threadId}
        onThreadChange={props.onThreadChange}
      />
      {props.children}
    </AomiWalletKitProvider>
  );
}

type WidgetFrameProps = Pick<
  AomiWidgetProps,
  | "width"
  | "height"
  | "className"
  | "style"
  | "walletPosition"
  | "walletFamilies"
  | "showSidebar"
  | "showHeader"
  | "features"
  | "controlBarProps"
  | "routing"
  | "clientOptions"
  | "inferenceFunding"
  | "persistThread"
  | "threadPersistenceKey"
  | "threadPersistenceScope"
  | "initialThreadId"
  | "threadId"
  | "onThreadChange"
> & { baseUrl: string; applicationId: string };

function WidgetFrame({
  baseUrl,
  applicationId,
  width = "100%",
  height = "80vh",
  className,
  style,
  walletPosition = "footer",
  walletFamilies = ["evm", "solana"],
  showSidebar = true,
  showHeader = true,
  features,
  controlBarProps,
  routing,
  clientOptions,
  inferenceFunding,
  persistThread,
  threadPersistenceKey,
  threadPersistenceScope,
  initialThreadId,
  threadId,
  onThreadChange,
}: WidgetFrameProps) {
  const walletKit = useAomiWalletKit();
  const [walletAccountMenu, setWalletAccountMenu] =
    useState<WalletAccountMenuOptions>();
  // A fresh anonymous widget session cannot read a previous guest's thread.
  // Hosts may still opt into their own guest persistence policy explicitly.
  const shouldPersistThread =
    persistThread ??
    Boolean(
      walletKit.accountUser || threadPersistenceKey || threadPersistenceScope,
    );
  const paymentClient = useMemo(
    () => createWidgetX402Client(walletKit),
    [walletKit.identity, walletKit.signTypedData, walletKit.switchChain],
  );
  const runtimeClientOptions = useMemo(
    () => ({
      x402: paymentClient,
      ...clientOptions,
      getAccountBearer: walletKit.getAccountBearer,
    }),
    [clientOptions, paymentClient, walletKit.getAccountBearer],
  );
  const showNetworkInHeader =
    showHeader && controlBarProps?.hideNetwork !== true;
  const resolvedRouting = routing ?? controlBarProps?.routing;
  const normalizedRouting = normalizeAomiRouting(resolvedRouting);
  const fixedAgentTarget =
    normalizedRouting.modes.length === 1 &&
    normalizedRouting.modes[0] === "direct" &&
    normalizedRouting.directApps.length === 1
      ? toAgentTarget(normalizedRouting.directApps[0]!)
      : undefined;
  return (
    <ShellTransportProvider
      baseUrl={baseUrl}
      getBearer={walletKit.getAccountBearer}
    >
      <AomiFrame.Root
        backendUrl={baseUrl}
        applicationId={applicationId}
        agentTarget={fixedAgentTarget}
        accountSessionAvailable={Boolean(walletKit.accountUser)}
        clientOptions={runtimeClientOptions}
        inferenceFunding={inferenceFunding}
        width={width}
        height={height}
        className={className}
        // A transform makes the root the containing block for the widget's
        // fixed overlays; keep the host's own transform.
        style={{
          ...style,
          transform: style?.transform
            ? `${style.transform} translateZ(0)`
            : "translateZ(0)",
        }}
        walletPosition={walletPosition}
        walletConnectLabel="Sign in"
        walletAccountMenu={walletAccountMenu}
        walletFamilies={walletFamilies}
        showSidebar={showSidebar}
        persistThread={shouldPersistThread}
        threadPersistenceKey={threadPersistenceKey}
        threadPersistenceScope={
          threadPersistenceScope ?? walletKit.accountUser?.id
        }
        initialThreadId={initialThreadId}
        threadId={threadId}
        onThreadChange={onThreadChange}
      >
        <SvmWalletBindingGate />
        <WidgetShell
          onAccountMenuChange={setWalletAccountMenu}
          features={features}
          showHeader={showHeader}
          showSidebar={showSidebar}
          showNetwork={showNetworkInHeader}
        />
        <AomiFrame.Composer
          withControl
          controlBarProps={{
            hideApiKey: true,
            ...controlBarProps,
            hideNetwork: showNetworkInHeader || controlBarProps?.hideNetwork,
            routing: resolvedRouting,
          }}
        />
      </AomiFrame.Root>
    </ShellTransportProvider>
  );
}
