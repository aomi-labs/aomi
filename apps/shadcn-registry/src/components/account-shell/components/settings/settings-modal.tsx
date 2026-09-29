"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ChartNoAxesCombined,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { useAomiWalletKit } from "../../../../lib/wallet-kit/context";
import { AomiButton } from "../../../ui/aomi/button";
import {
  ModalHeader,
  ModalNav,
  ModalNavItem,
  ModalShell,
  ModalSidebar,
} from "../../../ui/aomi/modal-shell";
import { GeneralSettings } from "../../features/general";
import { AccountSettings } from "../../features/account";
import { UsageSettings } from "../../features/usage";
import { PolicyPage } from "../../features/policy";
import {
  useAomiSession,
  type AomiSessionStatus,
} from "../providers/aomi-session-bridge";

/** Tab ids are stable deep-link keys; "policy" is labelled Safety. */
import type { SettingsTab } from "../../lib/settings-events";

export type { SettingsTab };

const NAV: {
  id: SettingsTab;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  {
    id: "general",
    label: "General",
    description: "Appearance, defaults, and account overview",
    Icon: SlidersHorizontal,
  },
  {
    id: "account",
    label: "Account",
    description: "Wallets and sign-in methods",
    Icon: UserRound,
  },
  {
    id: "policy",
    label: "Safety",
    description: "Guard policy and signing permissions",
    Icon: ShieldCheck,
  },
  {
    id: "usage",
    label: "Usage",
    description: "Spend, allowance, and statements",
    Icon: ChartNoAxesCombined,
  },
];

function GateAction({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <AomiButton variant="primary" onClick={onClick}>
      {children}
    </AomiButton>
  );
}

function GateNotice({
  status,
  walletConnected,
  detail,
  onRetry,
  onConnect,
}: {
  status: Exclude<AomiSessionStatus, "ready">;
  walletConnected?: boolean;
  detail?: string;
  onRetry: () => void;
  onConnect?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {status === "anonymous" && walletConnected && (
        <>
          <span className="type-row text-aomi-fg">Finish signing in</span>
          <span className="type-meta text-aomi-muted max-w-sm">
            Your wallet is connected, but your account session isn’t set up yet.
            Sign in to view and manage your settings.
          </span>
          {detail && (
            <span className="type-meta text-aomi-danger max-w-sm">
              {detail}
            </span>
          )}
          <GateAction onClick={onRetry}>Sign in</GateAction>
        </>
      )}
      {status === "anonymous" && !walletConnected && (
        <>
          <span className="type-row text-aomi-fg">Connect your account</span>
          <span className="type-meta text-aomi-muted max-w-sm">
            Settings are tied to your account. Connect to view and manage them.
          </span>
          {onConnect && (
            <GateAction onClick={onConnect}>Connect account</GateAction>
          )}
        </>
      )}
      {status === "establishing" && (
        <span className="type-meta text-aomi-muted">
          Connecting your account…
        </span>
      )}
      {status === "error" && (
        <>
          <span className="type-meta text-aomi-muted">
            Couldn’t connect your account. Please try again.
          </span>
          <GateAction onClick={onRetry}>Retry</GateAction>
        </>
      )}
    </div>
  );
}

/** Settings shares Library's persistent sidebar and quiet directory surfaces. */
export function SettingsModal({
  onClose,
  initialTab = "general",
  accountOnly = false,
}: {
  onClose: () => void;
  initialTab?: SettingsTab;
  accountOnly?: boolean;
}) {
  const [tab, setTab] = useState<SettingsTab>(
    accountOnly ? "account" : initialTab,
  );
  const { status, retry } = useAomiSession();
  const adapter = useAomiWalletKit();
  const hadSession = useRef(status === "ready");
  useEffect(() => {
    if (status === "ready") hadSession.current = true;
    else if (status === "anonymous" && hadSession.current) onClose();
  }, [status, onClose]);
  const activeNav = NAV.find((item) => item.id === tab) ?? NAV[0];

  const renderContent = () => {
    if (status === "anonymous" || status === "establishing") {
      return (
        <GateNotice
          status={status}
          walletConnected={adapter.identity.isConnected}
          detail={adapter.accountError}
          onRetry={retry}
          onConnect={() => {
            void adapter.connect?.();
          }}
        />
      );
    }
    if (status === "error" && tab === "general") {
      return <GateNotice status={status} onRetry={retry} />;
    }

    return (
      // Every tab fills the pane on the header's px-6 edges; pages never set
      // their own width.
      <div data-settings-column className="w-full px-6 pb-6 pt-1">
        {status === "error" && (
          <div className="border-aomi-border bg-aomi-surface-2 text-aomi-muted type-meta rounded-control mb-5 flex items-center justify-between gap-3 border px-3.5 py-2.5">
            <span>
              Couldn’t refresh your account — some live data may be unavailable.
            </span>
            <AomiButton variant="ghost" size="sm" onClick={retry}>
              Retry
            </AomiButton>
          </div>
        )}
        {tab === "general" ? (
          <GeneralSettings
            onManageAccount={() => setTab("account")}
            onViewUsage={() => setTab("usage")}
            onFixWallets={() => setTab("account")}
          />
        ) : tab === "account" ? (
          <AccountSettings onClose={onClose} />
        ) : tab === "usage" ? (
          <UsageSettings />
        ) : (
          <PolicyPage />
        )}
      </div>
    );
  };

  return (
    <ModalShell
      labelledBy="settings-title"
      dismissLabel="Dismiss settings"
      closeLabel="Close settings"
      onClose={onClose}
    >
      <ModalSidebar title="Settings" titleId="settings-title" icon={Settings2}>
        <ModalNav label="Settings sections" className="mt-2 md:mt-3">
          {NAV.filter((item) => !accountOnly || item.id === "account").map(
            ({ id, label, Icon }) => (
              <ModalNavItem
                key={id}
                label={label}
                icon={Icon}
                active={id === tab}
                onClick={() => setTab(id)}
              />
            ),
          )}
        </ModalNav>
      </ModalSidebar>

      <section className="flex min-h-0 min-w-0 flex-col">
        <ModalHeader
          title={activeNav.label}
          description={activeNav.description}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {renderContent()}
        </div>
      </section>
    </ModalShell>
  );
}
