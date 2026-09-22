"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AomiFrame,
  useAomiWalletKit,
  type AomiRoutingConfig,
  type DirectRoutingApp,
  type WalletAccountMenuOptions,
} from "@aomi-labs/widget-lib";
import {
  getBackendUrl,
  HeaderControls,
  PackagesModal,
  SettingsModal,
  useAccountOverview,
  usePortalWalletAccountMenu,
  type SettingsTab,
} from "@aomi-labs/widget-lib/host-composition";
import {
  useAomiRuntime,
  useControl,
  usePerThreadControl,
} from "@aomi-labs/react";
import { OverlayPortal } from "@portal/components/shell/overlay-portal";
import {
  usePortalClientOptions,
  useRequestedAppConfig,
} from "@portal/lib/portal-client-options";
import { SvmWalletBindingGate } from "@portal/features/general/svm-wallet-binding-gate";

const DEFAULT_ENABLED_APPS = ["default"] as const;
const GUEST_SESSION_TIMEOUT_MS = 8_000;

function directTarget(
  app: string,
  applicationId: string | null,
): DirectRoutingApp {
  const parsed = applicationId === null ? NaN : Number(applicationId);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { app, applicationId: parsed }
    : { app };
}

function PortalComposer({
  enabledApps,
  enabledApplicationIds,
  lockedTarget,
}: {
  enabledApps: readonly string[];
  enabledApplicationIds: readonly number[];
  lockedTarget?: DirectRoutingApp;
}) {
  const { state } = useControl();
  const installedIds = useMemo(
    () => new Set(enabledApplicationIds),
    [enabledApplicationIds],
  );
  const directApps = useMemo<DirectRoutingApp[]>(
    () =>
      enabledApps
        .filter((app) => app !== "orchestrator" && app !== "auto")
        .flatMap((app) => {
          const matching = state.appDescriptors.filter(
            (descriptor) => descriptor.name === app,
          );
          const hosted = matching.flatMap((descriptor) => {
            const applicationId = Number(descriptor.applicationId);
            return Number.isSafeInteger(applicationId) &&
              applicationId > 0 &&
              installedIds.has(applicationId)
              ? [{ app, applicationId }]
              : [];
          });
          const hasHostedIdentity = matching.some((descriptor) => {
            const applicationId = Number(descriptor.applicationId);
            return Number.isSafeInteger(applicationId) && applicationId > 0;
          });
          return hosted.length > 0 || hasHostedIdentity ? hosted : [{ app }];
        }),
    [enabledApps, installedIds, state.appDescriptors],
  );
  const routing = useMemo<AomiRoutingConfig>(
    () =>
      lockedTarget
        ? {
            targets: [{ mode: "direct", apps: [lockedTarget] }],
            defaultMode: "direct",
            showFixedControls: true,
          }
        : {
            targets: [
              { mode: "auto" },
              ...(directApps.length > 0
                ? [{ mode: "direct" as const, apps: directApps }]
                : []),
            ],
            defaultMode: "auto",
          },
    [directApps, lockedTarget],
  );

  return (
    <AomiFrame.Composer
      withControl
      controlBarProps={{
        hideApiKey: true,
        routing,
        enabledAppIds: enabledApps,
        hideNetwork: true,
      }}
    />
  );
}

function RequestedAppBootstrap({
  requestedApp,
  requestedApplicationId,
  enabledApps,
}: {
  requestedApp: string | null;
  requestedApplicationId: string | null;
  enabledApps: readonly string[];
}) {
  const { onAgentTargetSelect } = usePerThreadControl().actions;
  const hasAppliedRequestedAppRef = useRef(false);

  useEffect(() => {
    if (
      hasAppliedRequestedAppRef.current ||
      !requestedApp ||
      !enabledApps.includes(requestedApp)
    ) {
      return;
    }
    onAgentTargetSelect({
      mode: "direct",
      ...directTarget(requestedApp, requestedApplicationId),
    });
    hasAppliedRequestedAppRef.current = true;
  }, [enabledApps, onAgentTargetSelect, requestedApp, requestedApplicationId]);

  return null;
}

/** Open an account-owned thread linked by MCP wallet-approval handoff. */
export function ThreadUrlBootstrap() {
  const { currentThreadId, selectThread, threadMetadata } = useAomiRuntime();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    const threadId = new URLSearchParams(window.location.search)
      .get("thread")
      ?.trim();
    if (!threadId) return;
    if (threadId === currentThreadId) {
      appliedRef.current = true;
      return;
    }
    // selectThread intentionally creates a new local thread for unknown ids.
    // Wait for the authenticated remote-thread list to hydrate first so an
    // MCP handoff cannot race startup and silently land on a blank chat.
    if (!threadMetadata.has(threadId)) return;
    appliedRef.current = true;
    selectThread(threadId);
  }, [currentThreadId, selectThread, threadMetadata]);

  return null;
}

function PortalFrameContents({
  requestedApp,
  requestedApplicationId,
  locked,
  enabledApps,
  openSettings,
  onWalletAccountMenuChange,
}: {
  requestedApp: string | null;
  requestedApplicationId: string | null;
  locked: boolean;
  enabledApps: readonly string[];
  openSettings: (tab: SettingsTab) => void;
  onWalletAccountMenuChange: (
    menu: WalletAccountMenuOptions | undefined,
  ) => void;
}) {
  // AomiFrame.Root creates the runtime provider. Keep this hook in its
  // subtree; calling it in PortalAomiFrame would read the provider before it
  // exists and make the real portal route fail during server rendering.
  const walletAccountMenu = usePortalWalletAccountMenu(
    useCallback(() => openSettings("general"), [openSettings]),
    useCallback(() => openSettings("account"), [openSettings]),
  );

  useEffect(() => {
    onWalletAccountMenuChange(walletAccountMenu);
  }, [onWalletAccountMenuChange, walletAccountMenu]);

  return (
    <>
      <ThreadUrlBootstrap />
      {!locked && (
        <RequestedAppBootstrap
          requestedApp={requestedApp}
          requestedApplicationId={requestedApplicationId}
          enabledApps={enabledApps}
        />
      )}
    </>
  );
}

export function PortalAomiFrame() {
  const { accountStatus, accountUser } = useAomiWalletKit();
  const accountOverview = useAccountOverview();
  const accountUserId = accountUser?.id;
  const [guestSession, setGuestSession] = useState<{
    checked: boolean;
    userId: string | null;
  }>({ checked: false, userId: null });
  useEffect(() => {
    if (accountStatus === "loading") return;
    if (accountUserId) {
      setGuestSession({ checked: true, userId: null });
      return;
    }
    // The widget kit deliberately hides temporary guests from account chrome.
    // Ask Better Auth whether this browser still owns a guest cookie before
    // enabling the remote thread list. No bearer or thread id is persisted.
    const backend = new URL(getBackendUrl(), window.location.href);
    if (backend.origin !== window.location.origin) {
      setGuestSession({ checked: true, userId: null });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (!cancelled) setGuestSession({ checked: true, userId: null });
    }, GUEST_SESSION_TIMEOUT_MS);
    void fetch("/api/auth/get-session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const session = (await response.json()) as {
          user?: { id?: unknown; isAnonymous?: unknown };
        } | null;
        return session?.user?.isAnonymous === true &&
          typeof session.user.id === "string"
          ? session.user.id
          : null;
      })
      .catch(() => null)
      .then((userId) => {
        if (!cancelled) {
          window.clearTimeout(timeout);
          setGuestSession({ checked: true, userId });
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [accountStatus, accountUserId]);
  const principalId =
    accountUserId ??
    (guestSession.userId ? `guest:${guestSession.userId}` : null);
  const [hasResolvedInitialAccount, setHasResolvedInitialAccount] = useState(
    accountStatus !== "loading",
  );
  const [accountFrameScope, setAccountFrameScope] = useState(() => ({
    accountUserId: principalId,
    revision: 0,
  }));
  const requestedApp = useRequestedAppConfig();
  const lockedApp = requestedApp.locked ? requestedApp.app : null;
  const lockedApplicationId = lockedApp ? requestedApp.applicationId : null;
  const enabledApps = accountOverview?.user.apps ?? DEFAULT_ENABLED_APPS;
  const enabledApplicationIds = accountOverview?.user.application_ids ?? [];
  const lockedTarget = useMemo(
    () =>
      lockedApp ? directTarget(lockedApp, lockedApplicationId) : undefined,
    [lockedApp, lockedApplicationId],
  );
  const clientOptions = usePortalClientOptions(lockedApp, lockedApplicationId);
  const backendUrl = getBackendUrl();
  // Settings and the packages catalog are siblings of the frame so their
  // backdrops cover the sidebar and chat as one surface.
  const [overlay, setOverlay] = useState<"none" | "settings" | "packages">(
    "none",
  );
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [walletAccountMenu, setWalletAccountMenu] =
    useState<WalletAccountMenuOptions>();
  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setOverlay("settings");
  }, []);
  useEffect(() => {
    if (accountStatus !== "loading") {
      setHasResolvedInitialAccount(true);
    }
  }, [accountStatus]);

  if (
    accountStatus !== "loading" &&
    accountFrameScope.accountUserId !== principalId
  ) {
    setAccountFrameScope({
      accountUserId: principalId,
      // A backend thread is owned by the principal that created it. Always
      // remount across an identity transition so an anonymous or previous
      // account's in-flight session cannot be submitted by the new principal.
      revision: accountFrameScope.revision + 1,
    });
  }

  if (!hasResolvedInitialAccount) {
    return (
      <main
        aria-busy="true"
        className="bg-background relative h-full w-full overflow-hidden"
      />
    );
  }

  return (
    <main
      aria-busy={!guestSession.checked}
      data-testid="portal-shell"
      inert={!guestSession.checked}
      className="bg-background relative h-full w-full overflow-hidden"
    >
      <AomiFrame.Root
        key={`principal-v2:${accountFrameScope.revision}:${accountFrameScope.accountUserId ?? "preauth"}`}
        width="100%"
        height="100%"
        backendUrl={backendUrl}
        applicationId={lockedApplicationId}
        agentTarget={
          lockedTarget ? { mode: "direct", ...lockedTarget } : undefined
        }
        accountSessionAvailable={Boolean(accountUser || guestSession.userId)}
        // Always open on the new-chat starting screen. Thread history remains
        // available in the sidebar, but the previously active thread is not
        // restored after a reload.
        persistThread={false}
        showSidebar
        walletPosition="footer"
        walletFamilies={["evm", "solana"]}
        walletConnectLabel="Sign in"
        walletAccountMenu={walletAccountMenu}
        className="portal-aomi-frame aui-suggestions-marquee rounded-none border-0 shadow-none"
        clientOptions={clientOptions}
        inferenceFunding={requestedApp.inferenceFunding}
      >
        <PortalFrameContents
          requestedApp={requestedApp.app}
          requestedApplicationId={requestedApp.applicationId}
          locked={Boolean(lockedApp)}
          enabledApps={enabledApps}
          openSettings={openSettings}
          onWalletAccountMenuChange={setWalletAccountMenu}
        />
        <AomiFrame.Header>
          <HeaderControls
            showSettings={Boolean(accountUser)}
            onOpenSettings={() => openSettings("general")}
            onOpenPackages={() => setOverlay("packages")}
          />
        </AomiFrame.Header>
        <PortalComposer
          enabledApps={enabledApps}
          enabledApplicationIds={enabledApplicationIds}
          lockedTarget={lockedTarget}
        />
        <SvmWalletBindingGate />
        {/* Inside the frame so they see the Aomi runtime (the settings
            account tab needs the live thread id); portalled to <body> so one
            backdrop still covers the sidebar and chat as one surface. */}
        {overlay === "settings" && (
          <OverlayPortal>
            <SettingsModal
              key={settingsTab}
              initialTab={settingsTab}
              onClose={() => setOverlay("none")}
            />
          </OverlayPortal>
        )}
        {overlay === "packages" && (
          <OverlayPortal>
            <PackagesModal onClose={() => setOverlay("none")} />
          </OverlayPortal>
        )}
      </AomiFrame.Root>
    </main>
  );
}
