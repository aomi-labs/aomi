"use client";

import {
  type CSSProperties,
  type ReactNode,
  type FC,
  createContext,
  useContext,
} from "react";
import {
  AomiRuntimeProvider,
  cn,
  useAomiRuntime,
  type AomiClientOptions,
  type AomiInferenceFundingSource,
} from "@aomi-labs/react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  ThreadListSidebar,
  type SidebarProduct,
} from "@/components/assistant-ui/threadlist-sidebar";
import { RuntimeTxHandler } from "@/components/runtime-tx-handler";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ControlBar, type ControlBarProps } from "@/components/control-bar";
import type { WalletAccountMenuOptions } from "@/components/control-bar/account-menu-types";
import { safeEnv } from "../lib/wallet-kit/env";
import { useActionCapabilities } from "../lib/wallet-kit";

// =============================================================================
// Composer Control Context - signals Thread to show inline controls
// =============================================================================

type ComposerControlContextValue = {
  enabled: boolean;
  controlBarProps?: Omit<ControlBarProps, "children">;
  welcomeTitle?: string;
};

const ComposerControlContext = createContext<ComposerControlContextValue>({
  enabled: false,
});

export const useComposerControl = () => useContext(ComposerControlContext);
// =============================================================================
// Types
// =============================================================================

type RootProps = {
  children?: ReactNode;
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
  style?: CSSProperties;
  /** Position of the wallet button in the sidebar */
  walletPosition?: "header" | "footer" | null;
  /** Which wallet families to show as dual slots (omit for single-family mode) */
  walletFamilies?: Array<"evm" | "solana">;
  /** Host-specific label for the anonymous wallet/account entry point. */
  walletConnectLabel?: string;
  /** Optional account menu on the sidebar wallet chip (portal supplies live data). */
  walletAccountMenu?: WalletAccountMenuOptions;
  /** Products in the sidebar wordmark dropdown. Pass `null` for a plain wordmark. */
  products?: SidebarProduct[] | null;
  /** Which product this frame is, for the wordmark badge (default: "chat"). */
  currentProductId?: string;
  /** Whether to show the thread list sidebar (default: true) */
  showSidebar?: boolean;
  /** Whether the thread list sidebar starts expanded (default: true) */
  defaultSidebarOpen?: boolean;
  /** Backend URL for the Aomi runtime */
  backendUrl?: string;
  /** Concrete hosted application used to isolate runtime and persisted threads. */
  applicationId?: number | string | null;
  /** Optional runtime client overrides. */
  clientOptions?: Omit<AomiClientOptions, "baseUrl">;
  /** Explicit inference funding lane for Agent turns. */
  inferenceFunding?: AomiInferenceFundingSource;
  /** Whether an account session can load thread history without a wallet. */
  accountSessionAvailable?: boolean;
  /** Persist the active materialized thread in localStorage. Defaults to true. */
  persistThread?: boolean;
  /** Full localStorage key override for vendors that need exact isolation. */
  threadPersistenceKey?: string;
  /** Extra key segment for tenant/user/app scoping without owning the full key. */
  threadPersistenceScope?: string | null;
  /** Thread to open before history discovery completes. */
  initialThreadId?: string;
};

type HeaderProps = {
  children?: ReactNode;
  /** Show the control bar in the header */
  withControl?: boolean;
  /** Props to pass to the ControlBar when withControl is true */
  controlBarProps?: Omit<ControlBarProps, "children">;
  /** Whether to show the sidebar toggle button (default: true) */
  showSidebarTrigger?: boolean;
  className?: string;
};

type ComposerProps = {
  children?: ReactNode;
  /** Show inline controls in the composer input area */
  withControl?: boolean;
  /** Props to pass to the ControlBar when withControl is true */
  controlBarProps?: Omit<ControlBarProps, "children">;
  /** Optional empty-state title shown beneath the Aomi mark. */
  welcomeTitle?: string;
  className?: string;
};

type FrameControlBarProps = ControlBarProps;

// =============================================================================
// Compound Components
// =============================================================================

/**
 * Root component - provides all context and layout container
 */
const Root: FC<RootProps> = ({
  children,
  width = "100%",
  height = "80vh",
  className,
  style,
  walletPosition = "footer",
  walletFamilies,
  walletConnectLabel,
  walletAccountMenu,
  products,
  currentProductId,
  showSidebar = true,
  defaultSidebarOpen = true,
  backendUrl,
  applicationId,
  clientOptions,
  inferenceFunding,
  accountSessionAvailable,
  persistThread,
  threadPersistenceKey,
  threadPersistenceScope,
  initialThreadId,
}) => {
  const resolvedBackendUrl =
    backendUrl ??
    safeEnv(() => process.env.NEXT_PUBLIC_BACKEND_URL) ??
    "http://127.0.0.1:8080";
  const frameStyle: CSSProperties = { width, height, ...style };
  const actions = useActionCapabilities();

  return (
    <AomiRuntimeProvider
      backendUrl={resolvedBackendUrl}
      actions={actions}
      applicationId={applicationId}
      clientOptions={clientOptions}
      inferenceFunding={inferenceFunding}
      accountSessionAvailable={accountSessionAvailable}
      persistThread={persistThread}
      threadPersistenceKey={threadPersistenceKey}
      threadPersistenceScope={threadPersistenceScope}
      initialThreadId={initialThreadId}
    >
      <SidebarProvider
        defaultOpen={defaultSidebarOpen}
        className="min-h-0! h-full"
      >
        <div
          className={cn(
            "rounded-4xl bg-aomi-bg flex h-full w-full overflow-hidden shadow-2xl",
            className,
          )}
          style={frameStyle}
        >
          {showSidebar && (
            <ThreadListSidebar
              walletPosition={walletPosition}
              walletFamilies={walletFamilies}
              walletConnectLabel={walletConnectLabel}
              walletAccountMenu={walletAccountMenu}
              products={products}
              currentProductId={currentProductId}
            />
          )}
          <SidebarInset className="relative flex min-h-0 flex-col">
            {children}
          </SidebarInset>
          <RuntimeTxHandler />
        </div>
      </SidebarProvider>
    </AomiRuntimeProvider>
  );
};

/**
 * Header component - renders the header with optional control bar
 */
const Header: FC<HeaderProps> = ({
  children,
  withControl,
  controlBarProps,
  showSidebarTrigger = true,
  className,
}) => {
  const { currentThreadId, getThreadMetadata } = useAomiRuntime();
  const meta = getThreadMetadata(currentThreadId);
  const currentTitle =
    meta?.title && meta.title !== "New Chat" ? meta.title : null;

  return (
    <header
      className={cn(
        "border-aomi-border text-aomi-fg flex h-14 shrink-0 items-center gap-2 border-b px-4",
        className,
      )}
    >
      {showSidebarTrigger && <SidebarTrigger />}
      {currentTitle && (
        <span className="hidden truncate text-sm font-medium md:block">
          {currentTitle}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2.5">
        {withControl && <ControlBar {...controlBarProps} />}
        {children}
      </div>
    </header>
  );
};

/**
 * Composer component - renders the thread with optional inline controls
 * When withControl={true}, controls appear inline in the composer input area
 */
const Composer: FC<ComposerProps> = ({
  children,
  withControl = false,
  controlBarProps,
  welcomeTitle,
  className,
}) => {
  const { currentThreadId, threadViewKey } = useAomiRuntime();

  return (
    <ComposerControlContext.Provider
      value={{ enabled: withControl, controlBarProps, welcomeTitle }}
    >
      <div className={cn("flex flex-1 flex-col overflow-hidden", className)}>
        <Thread key={`${currentThreadId}-${threadViewKey}`} />
        {children}
      </div>
    </ComposerControlContext.Provider>
  );
};

/**
 * ControlBar component - wrapper for the control bar with frame styling
 */
const FrameControlBar: FC<FrameControlBarProps> = (props) => {
  return <ControlBar {...props} />;
};

// =============================================================================
// Default Layout Component (Simple API)
// =============================================================================

type DefaultLayoutProps = Omit<RootProps, "children">;

/**
 * Default layout - controls are inline in the composer input area
 * Usage: <AomiFrame /> or <AomiFrame walletPosition="header" />
 */
const DefaultLayout: FC<DefaultLayoutProps> = ({
  walletPosition = "footer",
  walletFamilies,
  showSidebar = true,
  ...props
}) => {
  // Hide wallet in ControlBar when it's shown in sidebar
  const hideWalletInControlBar = walletPosition !== null;

  return (
    <Root
      walletPosition={walletPosition}
      walletFamilies={walletFamilies}
      showSidebar={showSidebar}
      {...props}
    >
      <Header
        withControl
        showSidebarTrigger={showSidebar}
        controlBarProps={{
          hideWallet: hideWalletInControlBar,
          hideNetwork: false,
        }}
      />
      <Composer />
    </Root>
  );
};

// =============================================================================
// Export Compound Component
// =============================================================================

export const AomiFrame = Object.assign(DefaultLayout, {
  Root,
  Header,
  Composer,
  ControlBar: FrameControlBar,
});

// Re-export types for consumers
export type {
  RootProps as AomiFrameRootProps,
  HeaderProps as AomiFrameHeaderProps,
  ComposerProps as AomiFrameComposerProps,
  FrameControlBarProps as AomiFrameControlBarProps,
};
