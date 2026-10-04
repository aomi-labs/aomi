"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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
  useSettingsOpenRequest,
  type SettingsTab,
} from "@aomi-labs/widget-lib/host-composition";
import { useAomiRuntime } from "@aomi-labs/react";
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

const AUTO_ROUTING: AomiRoutingConfig = { targets: [{ mode: "auto" }] };

/**
 * Portal chats always run Auto; users tag apps with the composer's + picker.
 * An unlocked `?app=` link pre-tags its app the same way; only a locked
 * project link pins its app, silently, as a Direct target.
 */
function PortalComposer({
  enabledApps,
  lockedTarget,
  appTag,
}: {
  enabledApps: readonly string[];
  lockedTarget?: DirectRoutingApp;
  appTag?: { app: string; applicationId?: number };
}) {
  const routing = useMemo<AomiRoutingConfig>(
    () =>
      lockedTarget
        ? {
            targets: [{ mode: "direct", apps: [lockedTarget] }],
            defaultMode: "direct",
          }
        : AUTO_ROUTING,
    [lockedTarget],
  );
  return (
    <AomiFrame.Composer
      withControl
      controlBarProps={{
        hideApiKey: true,
        routing,
        enabledAppIds: enabledApps,
        initialAppTag: appTag,
        hideNetwork: true,
      }}
    />
  );
}

/** Open an account-owned thread linked by MCP wallet-approval handoff. */
type ThreadUrlSnapshot = {
  navigating: boolean;
  requestedThread: string | null | undefined;
};

export function createThreadUrlNavigation() {
  let snapshot: ThreadUrlSnapshot = {
    navigating: true,
    requestedThread: undefined,
  };
  const listeners = new Set<() => void>();
  const update = (next: ThreadUrlSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigate: (requestedThread: string | null) =>
      update({ navigating: true, requestedThread }),
    settle: () => update({ ...snapshot, navigating: false }),
    sync: (requestedThread: string | null) =>
      update({ navigating: false, requestedThread }),
  };
}
export type ThreadUrlNavigation = ReturnType<typeof createThreadUrlNavigation>;

export function ThreadUrlBootstrap({
  ready = true,
  navigation,
}: {
  ready?: boolean;
  navigation?: ThreadUrlNavigation;
}) {
  const {
    currentThreadId,
    selectThread,
    createThread,
    threadMetadata,
    threadListLoading,
    threadListError,
    showNotification,
    events = [],
    isRemoteThread,
  } = useAomiRuntime();
  const [localNavigation] = useState(createThreadUrlNavigation);
  const locationState = navigation ?? localNavigation;
  const navigationSnapshot = useSyncExternalStore(
    locationState.subscribe,
    locationState.getSnapshot,
    locationState.getSnapshot,
  );
  const { navigating, requestedThread } = navigationSnapshot;
  useEffect(() => {
    const readLocation = () => {
      locationState.navigate(
        new URLSearchParams(window.location.search).get("thread")?.trim() ||
          null,
      );
    };
    // Assistant-ui's per-chat boundary remounts this subtree. Only initial
    // host restoration or browser navigation should reopen the current URL.
    if (locationState.getSnapshot().requestedThread === undefined)
      readLocation();
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, [locationState]);

  useEffect(() => {
    if (locationState.getSnapshot() !== navigationSnapshot) return;
    if (
      !ready ||
      !navigating ||
      requestedThread === undefined ||
      threadListLoading ||
      threadListError
    )
      return;
    if (requestedThread) {
      const metadata = threadMetadata.get(requestedThread);
      if (metadata && metadata.status !== "archived") {
        if (requestedThread !== currentThreadId) {
          selectThread(requestedThread);
          return;
        }
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete("thread");
        window.history.replaceState(null, "", url);
        showNotification({
          type: "error",
          title: "Conversation unavailable",
          message:
            "This chat may have been archived or belongs to another account. Start a new chat or choose one from Recent.",
        });
        locationState.navigate(null);
        void createThread();
        return;
      }
    } else if (isRemoteThread?.(currentThreadId) ?? events.length > 0) {
      void createThread();
      return;
    }
    locationState.settle();
  }, [
    ready,
    requestedThread,
    currentThreadId,
    createThread,
    selectThread,
    threadMetadata,
    threadListLoading,
    threadListError,
    showNotification,
    events,
    isRemoteThread,
    locationState,
    navigating,
    navigationSnapshot,
  ]);

  useEffect(() => {
    const latest = locationState.getSnapshot();
    if (latest !== navigationSnapshot) return;
    if (
      !ready ||
      threadListLoading ||
      latest.navigating ||
      latest.requestedThread === undefined
    )
      return;
    const url = new URL(window.location.href);
    const locationThread = url.searchParams.get("thread")?.trim() || null;
    // Next can render its changed search params before our popstate listener
    // runs. A changed browser location wins over this render's old chat.
    if (locationThread !== latest.requestedThread) {
      locationState.navigate(locationThread);
      return;
    }
    const metadata = threadMetadata.get(currentThreadId);
    const threadId =
      metadata &&
      (isRemoteThread?.(currentThreadId) ?? metadata.title !== "New Chat") &&
      metadata.status !== "archived"
        ? currentThreadId
        : null;
    if (url.searchParams.get("thread") === threadId) return;
    if (threadId) url.searchParams.set("thread", threadId);
    else url.searchParams.delete("thread");
    window.history.pushState(null, "", url);
    locationState.sync(threadId);
  }, [
    ready,
    currentThreadId,
    threadMetadata,
    requestedThread,
    isRemoteThread,
    threadListLoading,
    locationState,
    navigating,
    navigationSnapshot,
  ]);

  return null;
}

function PortalFrameContents({
  openSettings,
  onWalletAccountMenuChange,
  ready,
  navigation,
}: {
  openSettings: (tab: SettingsTab) => void;
  onWalletAccountMenuChange: (
    menu: WalletAccountMenuOptions | undefined,
  ) => void;
  ready: boolean;
  navigation: ThreadUrlNavigation;
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

  return <ThreadUrlBootstrap ready={ready} navigation={navigation} />;
}

export function PortalAomiFrame() {
  const { accountStatus, accountUser } = useAomiWalletKit();
  const enabledApps = useAccountOverview()?.user.apps ?? DEFAULT_ENABLED_APPS;
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
  const [accountFrameScope, setAccountFrameScope] = useState(() => ({
    accountUserId: principalId,
    initialized: false,
    revision: 0,
  }));
  const requestedApp = useRequestedAppConfig();
  const lockedApp = requestedApp.locked ? requestedApp.app : null;
  const lockedApplicationId = lockedApp ? requestedApp.applicationId : null;
  const lockedTarget = useMemo(
    () =>
      lockedApp ? directTarget(lockedApp, lockedApplicationId) : undefined,
    [lockedApp, lockedApplicationId],
  );
  const appTag = useMemo(
    () =>
      requestedApp.app && !requestedApp.locked
        ? {
            ...directTarget(requestedApp.app, requestedApp.applicationId),
            app: requestedApp.app,
          }
        : undefined,
    [requestedApp.app, requestedApp.applicationId, requestedApp.locked],
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
  // In-chat controls (the composer's safety menu) deep-link into Settings.
  useSettingsOpenRequest(openSettings);
  if (
    accountStatus !== "loading" &&
    guestSession.checked &&
    (!accountFrameScope.initialized ||
      accountFrameScope.accountUserId !== principalId)
  ) {
    setAccountFrameScope({
      accountUserId: principalId,
      initialized: true,
      // A backend thread is owned by the principal that created it. Always
      // remount across an identity transition so an anonymous or previous
      // account's in-flight session cannot be submitted by the new principal.
      revision:
        accountFrameScope.revision + (accountFrameScope.initialized ? 1 : 0),
    });
  }

  const restoringSession = accountStatus === "loading" || !guestSession.checked;
  const [threadUrlState, setThreadUrlState] = useState(() => ({
    revision: accountFrameScope.revision,
    navigation: createThreadUrlNavigation(),
  }));
  if (threadUrlState.revision !== accountFrameScope.revision) {
    setThreadUrlState({
      revision: accountFrameScope.revision,
      navigation: createThreadUrlNavigation(),
    });
  }

  return (
    <main
      aria-busy={restoringSession}
      data-testid="portal-shell"
      className="bg-background relative h-full w-full overflow-hidden"
    >
      <div
        data-testid="portal-frame-content"
        inert={restoringSession}
        className="h-full w-full"
      >
        <AomiFrame.Root
          key={`principal-v3:${accountFrameScope.revision}`}
          width="100%"
          height="100%"
          backendUrl={backendUrl}
          applicationId={lockedApplicationId}
          agentTarget={
            lockedTarget ? { mode: "direct", ...lockedTarget } : undefined
          }
          accountSessionAvailable={Boolean(accountUser || guestSession.userId)}
          // The host restores saved chats from the URL through ThreadUrlBootstrap.
          // Without a thread URL, open the new-chat starting screen.
          persistThread={false}
          showSidebar
          walletPosition="footer"
          walletFamilies={["evm", "solana"]}
          walletConnectLabel="Sign in"
          walletAccountMenu={walletAccountMenu}
          className="portal-aomi-frame rounded-none border-0 shadow-none"
          clientOptions={clientOptions}
          inferenceFunding={requestedApp.inferenceFunding}
        >
          <PortalFrameContents
            navigation={threadUrlState.navigation}
            ready={!restoringSession}
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
            lockedTarget={lockedTarget}
            appTag={appTag}
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
      </div>
    </main>
  );
}
