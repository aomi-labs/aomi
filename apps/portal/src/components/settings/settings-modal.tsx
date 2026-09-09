"use client";

import { useState, type ComponentType } from "react";
import { LineChart, Settings, Wallet, X } from "lucide-react";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import { ModalBackdrop } from "@/components/ui/modal-backdrop";
import { GeneralSettings } from "@portal/features/general";
import { AccountSettings } from "@portal/features/account";
import { UsageSettings } from "@portal/features/usage";
import {
  useAomiSession,
  type AomiSessionStatus,
} from "@portal/components/providers/aomi-session-bridge";

export type SettingsTab = "general" | "account" | "usage";

const NAV: {
  id: SettingsTab;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "general", label: "General", Icon: Settings },
  { id: "account", label: "Account", Icon: Wallet },
  { id: "usage", label: "Usage", Icon: LineChart },
];

function GateNotice({
  status,
  walletConnected,
  detail,
  onRetry,
  onConnect,
}: {
  status: Exclude<AomiSessionStatus, "ready">;
  walletConnected?: boolean;
  /** Provider-reported reason the session could not be created. */
  detail?: string;
  onRetry: () => void;
  onConnect?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      {status === "anonymous" && walletConnected && (
        <>
          <span className="text-aomi-fg text-sm font-medium">
            Finish signing in
          </span>
          <span className="text-aomi-muted max-w-sm text-[13px]">
            Your wallet is connected, but your account session isn’t set up yet.
            Sign in to view and manage your settings.
          </span>
          {detail && (
            <span className="text-aomi-danger max-w-sm text-[12px]">
              {detail}
            </span>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="bg-aomi-fg text-aomi-bg rounded-full px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        </>
      )}
      {status === "anonymous" && !walletConnected && (
        <>
          <span className="text-aomi-fg text-sm font-medium">
            Connect your account
          </span>
          <span className="text-aomi-muted max-w-sm text-[13px]">
            Settings are tied to your account. Connect to view and manage them.
          </span>
          {onConnect && (
            <button
              type="button"
              onClick={onConnect}
              className="bg-aomi-fg text-aomi-bg rounded-full px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
            >
              Connect account
            </button>
          )}
        </>
      )}
      {status === "establishing" && (
        <span className="text-aomi-muted text-[13px]">
          Connecting your account…
        </span>
      )}
      {status === "error" && (
        <>
          <span className="text-aomi-muted text-[13px]">
            Couldn’t connect your account. Please try again.
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="bg-aomi-fg text-aomi-bg rounded-full px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Settings as a popup over the chat — the aomi-chat-design modal, built
 * entirely on the `aomi-*` design tokens: overlay softens the full frame,
 * 900×600 panel, left nav, content header with the active tab title and a
 * close button.
 */
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

  const renderContent = () => {
    // Anonymous / still-connecting sessions have nothing to show — gate fully.
    // A probe *error* (backend unreachable) only blocks the account-backed
    // General tab; Account and Usage render their clearly-marked fixtures so
    // the surfaces stay reviewable, with a slim retry banner on top.
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
      <div className="border-aomi-border bg-aomi-surface-2 text-aomi-muted mx-[22px] mt-4 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px]">
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
          <div className="px-[22px] py-5">
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
      <ModalBackdrop aria-label="Dismiss" onClick={onClose} />
      <div
        className="border-aomi-border bg-aomi-raised text-aomi-fg relative flex overflow-hidden rounded-2xl border"
        // Inline geometry: immune to Tailwind arbitrary-class scanning misses.
        style={{ width: 900, height: 600, maxWidth: "95%", maxHeight: "92%" }}
      >
        <nav className="border-aomi-border bg-aomi-bg/40 flex w-[220px] flex-shrink-0 flex-col gap-0.5 border-r p-3 pt-[18px]">
          <span className="px-2.5 pb-3 pt-1 text-[15px] font-semibold">
            Settings
          </span>
          {NAV.map(({ id, label, Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-left transition-colors ${
                  active ? "bg-aomi-accent-subtle" : "hover:bg-aomi-hover"
                }`}
              >
                <Icon
                  className={`size-4 ${
                    active ? "text-aomi-accent-strong" : "text-aomi-muted"
                  }`}
                />
                <span
                  className={`text-sm ${
                    active ? "text-aomi-fg font-medium" : "text-aomi-muted"
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-aomi-border flex items-center justify-between border-b px-[22px] py-[18px]">
            <span className="text-base font-semibold">
              {NAV.find((n) => n.id === tab)?.label}
            </span>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="bg-aomi-surface-2 text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex h-8 w-8 items-center justify-center rounded-full transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
