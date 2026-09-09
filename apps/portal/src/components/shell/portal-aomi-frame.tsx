"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AomiFrame, useAomiWalletKit } from "@aomi-labs/widget-lib";
import type { WalletAccountMenuOptions } from "@aomi-labs/widget-lib";
import { useAomiRuntime, usePerThreadControl } from "@aomi-labs/react";
import { HeaderControls } from "@portal/components/shell/header-controls";
import { OverlayPortal } from "@portal/components/shell/overlay-portal";
import { PackagesModal } from "@portal/components/shell/packages-modal";
import { SettingsModal } from "@portal/components/settings/settings-modal";
import type { SettingsTab } from "@portal/components/settings/settings-modal";
import {
  usePortalClientOptions,
  useRequestedAppConfig,
} from "@portal/lib/portal-client-options";
import { getBackendUrl } from "@portal/lib/settings-api";
import { SvmWalletBindingGate } from "@portal/features/general/svm-wallet-binding-gate";
import { usePortalWalletAccountMenu } from "@portal/components/shell/use-portal-wallet-account-menu";

function AppSelectUrlBootstrap({
  requestedApp,
  requestedApplicationId,
  locked,
}: {
  requestedApp: string | null;
  requestedApplicationId: string | null;
  locked: boolean;
}) {
  const { createThread, currentThreadId } = useAomiRuntime();
  const { onAppSelect } = usePerThreadControl().actions;
  const hasAppliedRequestedAppRef = useRef(false);
  const hasStartedLockedThreadRef = useRef<string | null>(null);
  const isDisposedRef = useRef(false);
  const [lockedThreadId, setLockedThreadId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      isDisposedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (hasAppliedRequestedAppRef.current) {
      return;
    }

    if (!requestedApp) {
      return;
    }

    if (!locked) {
      onAppSelect(requestedApp, { applicationId: requestedApplicationId });
      hasAppliedRequestedAppRef.current = true;
      return;
    }

    if (hasStartedLockedThreadRef.current === requestedApp) {
      return;
    }
    hasStartedLockedThreadRef.current = requestedApp;
    void createThread()
      .then((threadId) => {
        if (
          !isDisposedRef.current &&
          hasStartedLockedThreadRef.current === requestedApp
        ) {
          setLockedThreadId(threadId);
        }
      })
      .catch((error) => {
        console.error("[aomi][portal-frame] failed to create locked thread", {
          app: requestedApp,
          error,
        });
      });
  }, [createThread, locked, onAppSelect, requestedApp, requestedApplicationId]);

  useEffect(() => {
    if (
      hasAppliedRequestedAppRef.current ||
      !locked ||
      !requestedApp ||
      !lockedThreadId ||
      currentThreadId !== lockedThreadId
    ) {
      return;
    }

    onAppSelect(requestedApp, { applicationId: requestedApplicationId });
    hasAppliedRequestedAppRef.current = true;
  }, [
    currentThreadId,
    locked,
    lockedThreadId,
    onAppSelect,
    requestedApp,
    requestedApplicationId,
  ]);

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
  openSettings,
  onWalletAccountMenuChange,
}: {
  requestedApp: string | null;
  requestedApplicationId: string | null;
  locked: boolean;
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
      <AppSelectUrlBootstrap
        requestedApp={requestedApp}
        requestedApplicationId={requestedApplicationId}
        locked={locked}
      />
    </>
  );
}

export function PortalAomiFrame() {
  const { accountStatus, accountUser } = useAomiWalletKit();
  const accountUserId = accountUser?.id;
  const [hasResolvedInitialAccount, setHasResolvedInitialAccount] = useState(
    accountStatus !== "loading",
  );
  const [accountFrameScope, setAccountFrameScope] = useState(() => ({
    accountUserId,
    revision: 0,
  }));
  const requestedApp = useRequestedAppConfig();
  const lockedApp = requestedApp.locked ? requestedApp.app : null;
  const lockedApplicationId = lockedApp ? requestedApp.applicationId : null;
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
    accountFrameScope.accountUserId !== accountUserId
  ) {
    setAccountFrameScope({
      accountUserId,
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
      data-testid="portal-shell"
      className="bg-background relative h-full w-full overflow-hidden"
    >
      <AomiFrame.Root
        key={`principal-v2:${accountFrameScope.revision}:${accountFrameScope.accountUserId ?? "preauth"}`}
        width="100%"
        height="100%"
        backendUrl={backendUrl}
        applicationId={lockedApplicationId}
        accountSessionAvailable={Boolean(accountUser)}
        // Do not restore a shared pre-auth thread: it may belong to a deleted
        // anonymous identity. Once Better Auth resolves a canonical user id,
        // persistence is isolated to that exact principal.
        persistThread={Boolean(accountUserId)}
        threadPersistenceScope={accountUserId}
        showSidebar={!lockedApp}
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
        <AomiFrame.Composer
          withControl
          controlBarProps={{
            hideApiKey: true,
            hideApp: Boolean(lockedApp),
            // The network picker lives in the header pill (HeaderControls).
            hideNetwork: true,
          }}
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
