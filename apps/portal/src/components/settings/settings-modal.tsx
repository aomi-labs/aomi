"use client";

import { useState, type ComponentType } from "react";
import {
  ChartNoAxesCombined,
  Settings2,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import { ModalBackdrop } from "@/components/ui/modal-backdrop";
import { GeneralSettings } from "@portal/features/general";
import { AccountSettings } from "@portal/features/account";
import { UsageSettings } from "@portal/features/usage";
import { directoryModalType } from "@portal/components/shell/directory-modal-type";
import {
  useAomiSession,
  type AomiSessionStatus,
} from "@portal/components/providers/aomi-session-bridge";

export type SettingsTab = "general" | "account" | "usage";

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
    description: "Wallets, sign-in methods, and signing",
    Icon: UserRound,
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
    <button
      type="button"
      onClick={onClick}
      className="bg-aomi-fg text-aomi-bg rounded-xl px-4 py-2 text-[12px] font-medium transition-opacity hover:opacity-90"
    >
      {children}
    </button>
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
    <div className="mx-auto flex h-full w-full max-w-[780px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {status === "anonymous" && walletConnected && (
        <>
          <span className="text-aomi-fg text-sm font-medium">
            Finish signing in
          </span>
          <span className="text-aomi-muted max-w-sm text-[12px] leading-relaxed">
            Your wallet is connected, but your account session isn’t set up yet.
            Sign in to view and manage your settings.
          </span>
          {detail && (
            <span className="text-aomi-danger max-w-sm text-[12px]">
              {detail}
            </span>
          )}
          <GateAction onClick={onRetry}>Sign in</GateAction>
        </>
      )}
      {status === "anonymous" && !walletConnected && (
        <>
          <span className="text-aomi-fg text-sm font-medium">
            Connect your account
          </span>
          <span className="text-aomi-muted max-w-sm text-[12px] leading-relaxed">
            Settings are tied to your account. Connect to view and manage them.
          </span>
          {onConnect && (
            <GateAction onClick={onConnect}>Connect account</GateAction>
          )}
        </>
      )}
      {status === "establishing" && (
        <span className="text-aomi-muted text-[12px]">
          Connecting your account…
        </span>
      )}
      {status === "error" && (
        <>
          <span className="text-aomi-muted text-[12px]">
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
}: {
  onClose: () => void;
  initialTab?: SettingsTab;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const { status, retry } = useAomiSession();
  const adapter = useAomiWalletKit();
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

    const errorBanner = status === "error" && (
      <div className="border-aomi-border bg-aomi-surface-2 text-aomi-muted mx-auto mt-5 flex w-[calc(100%-48px)] max-w-[780px] items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-[12px]">
        <span>
          Couldn’t refresh your account — some live data may be unavailable.
        </span>
        <button
          type="button"
          onClick={retry}
          className="text-aomi-fg shrink-0 font-medium hover:opacity-80"
        >
          Retry
        </button>
      </div>
    );

    switch (tab) {
      case "general":
        return status === "error" ? (
          <GateNotice status={status} onRetry={retry} />
        ) : (
          <div className="mx-auto w-full max-w-[780px] px-6 py-6">
            <GeneralSettings
              onManageAccount={() => setTab("account")}
              onViewUsage={() => setTab("usage")}
              onFixWallets={() => setTab("account")}
            />
          </div>
        );
      case "account":
        return (
          <>
            {errorBanner}
            <AccountSettings />
          </>
        );
      case "usage":
        return (
          <>
            {errorBanner}
            <UsageSettings />
          </>
        );
    }
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 60 }}
    >
      <ModalBackdrop aria-label="Dismiss settings" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="border-aomi-border bg-aomi-raised text-aomi-fg relative overflow-hidden rounded-[22px] border shadow-[0_24px_70px_rgba(0,0,0,0.08)]"
        style={{ width: 1080, height: 620, maxWidth: "96%", maxHeight: "92%" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg absolute right-4 top-4 z-20 flex size-7 items-center justify-center rounded-full transition-colors"
        >
          <X className="size-3.5" />
        </button>
        <div className="grid h-full min-h-0 md:grid-cols-[185px_minmax(0,1fr)]">
          <aside className="border-aomi-border bg-aomi-bg/40 min-h-0 border-r p-3">
            <div className="flex items-center gap-2 px-2.5 py-3">
              <Settings2 className="text-aomi-accent size-4" />
              <h1
                id="settings-title"
                className={`flex-1 ${directoryModalType.modalTitle}`}
              >
                Settings
              </h1>
            </div>
            <nav className="mt-3 space-y-0.5" aria-label="Settings sections">
              {NAV.map(({ id, label, Icon }) => {
                const active = id === tab;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-pressed={active}
                    className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 transition-colors ${directoryModalType.navigation} ${
                      active
                        ? "bg-aomi-surface-2 font-medium"
                        : "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg"
                    }`}
                  >
                    <Icon className="size-4" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col">
            <header className="border-aomi-border flex min-h-[74px] items-center border-b px-6 py-4">
              <div className="min-w-0">
                <h2 className={directoryModalType.pageTitle}>
                  {activeNav.label}
                </h2>
                <p
                  className={`text-aomi-muted mt-1 ${directoryModalType.pageDescription}`}
                >
                  {activeNav.description}
                </p>
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {renderContent()}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
