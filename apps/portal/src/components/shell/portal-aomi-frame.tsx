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
export function ThreadUrlBootstrap({ ready = true }: { ready?: boolean }) {
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
  const [requestedThread, setRequestedThread] = useState<
    string | null | undefined
  >(undefined);
  const navigating = useRef(true);
  useEffect(() => {
    const readLocation = () => {
      navigating.current = true;
      setRequestedThread(
        new URLSearchParams(window.location.search).get("thread")?.trim() ||
          null,
      );
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, []);

  useEffect(() => {
    if (
      !ready ||
      !navigating.current ||
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
        setRequestedThread(null);
        void createThread();
        return;
      }
    } else if (isRemoteThread?.(currentThreadId) ?? events.length > 0) {
      void createThread();
      return;
    }
    navigating.current = false;
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
  ]);

  useEffect(() => {
    if (
      !ready ||
      threadListLoading ||
      navigating.current ||
      requestedThread === undefined
    )
      return;
    const metadata = threadMetadata.get(currentThreadId);
    const threadId =
      metadata &&
      (isRemoteThread?.(currentThreadId) ?? metadata.title !== "New Chat") &&
      metadata.status !== "archived"
        ? currentThreadId
        : null;
    const url = new URL(window.location.href);
    if (url.searchParams.get("thread") === threadId) return;
    if (threadId) url.searchParams.set("thread", threadId);
    else url.searchParams.delete("thread");
    window.history.pushState(null, "", url);
  }, [
    ready,
    currentThreadId,
    threadMetadata,
    requestedThread,
    isRemoteThread,
    threadListLoading,
  ]);

  return null;
}

function PortalFrameContents({
  openSettings,
  onWalletAccountMenuChange,
  ready,
}: {
  openSettings: (tab: SettingsTab) => void;
  onWalletAccountMenuChange: (
    menu: WalletAccountMenuOptions | undefined,
  ) => void;
  ready: boolean;
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

  return <ThreadUrlBootstrap ready={ready} />;
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

  return (
    <main
      aria-busy={restoringSession}
      data-testid="portal-shell"
      className="bg-background relative h-full w-full overflow-hidden"
    >
      <div inert={restoringSession} className="h-full w-full">
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
          walletConnectLabel={
            restoringSession ? "Restoring session…" : "Sign in"
          }
          walletAccountMenu={walletAccountMenu}
          className="portal-aomi-frame rounded-none border-0 shadow-none"
          clientOptions={clientOptions}
          inferenceFunding={requestedApp.inferenceFunding}
        >
          <PortalFrameContents
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
      {restoringSession && (
        <p
          role="status"
          className="text-muted-foreground bg-background pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs"
        >
          Restoring session… Your composer will be ready shortly.
        </p>
      )}
    </main>
  );
}
