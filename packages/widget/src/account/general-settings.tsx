"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getChainInfo } from "@aomi-labs/react";
import type { AomiCreditPosition } from "@aomi-labs/client";
import { AccountAvatar } from "./account-avatar";
import { useAccountCredits } from "./use-account-credits";
import { useAomiWalletKit } from "@/wallet/context";
import { Shield } from "lucide-react";
import { AomiButton } from "@/ui/aomi/button";
import { getChainIcon } from "@/icons/chain-map";
import { Meter } from "./usage/usage-shared";
import { countDriftedWallets } from "@/wallet/wallet-attention";
import { useAccountAcl } from "./use-account-acl";
import { walletConnectionSummary } from "@/wallet/wallet-management-model";
import {
  creditAllowanceFromPosition,
  formatAllowanceCredits,
  tierLabel,
  useAccountOverview,
  useAccountOverviewStore,
} from "./account-overview";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { useSettings, type ColorMode } from "./use-settings";
import {
  Divider,
  SettingRow,
  SettingsSectionHeading,
  settingsPanelClass,
} from "./settings-rows";

/**
 * Settings › General — design-sync summary card (plan, allowance, identity)
 * on live `/api/account` data, plus theme / network / wallet rows.
 */
export function GeneralSettings({
  onManageAccount,
  onViewUsage,
  onFixWallets,
}: {
  onManageAccount?: () => void;
  onViewUsage?: () => void;
  onFixWallets?: () => void;
}) {
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;
  const { settings, updateSetting } = useSettings();
  const account = useAccountOverview();
  const overviewStore = useAccountOverviewStore();
  const [overviewSettled, setOverviewSettled] = useState(false);
  const position = useAccountCredits();
  const credits =
    position.isPending && position.fetchStatus !== "idle"
      ? undefined
      : (position.data ?? null);
  const acl = useAccountAcl();
  // undefined while loading; null when unavailable.

  useEffect(() => {
    let mounted = true;
    void overviewStore.loadOnce().then(() => {
      if (mounted) setOverviewSettled(true);
    });
    return () => {
      mounted = false;
    };
  }, [overviewStore]);

  const networkName = identity.chainId
    ? getChainInfo(identity.chainId)?.name
    : undefined;
  const NetworkIcon = identity.chainId
    ? getChainIcon(identity.chainId)
    : undefined;

  const walletAttentionCount =
    acl.status === "ready" ? countDriftedWallets(acl.wallets) : 0;

  const wallets = adapter.wallets;
  const connectedWallets = wallets.filter((wallet) => wallet.connected).length;
  const linkedWallets = wallets.filter((wallet) => wallet.linked).length;
  const linkedWalletStatus = walletConnectionSummary(wallets);
  const accountName =
    adapter.accountUser?.displayName?.trim() ||
    adapter.accountUser?.email ||
    account?.user.verified_email ||
    "Aomi account";

  // The summary card draws from three reads; show it once all have answered.
  if (!overviewSettled || credits === undefined || acl.status === "loading") {
    return <LoadingPane label="Loading account overview" />;
  }

  const themeChoices: { mode: ColorMode; label: string }[] = [
    { mode: "dark", label: "Dark" },
    { mode: "light", label: "Light" },
    { mode: "auto", label: "System" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {walletAttentionCount > 0 && (
        <WalletAttentionBanner
          walletAttentionCount={walletAttentionCount}
          onReview={onFixWallets ?? onManageAccount}
        />
      )}

      <section className="flex flex-col gap-2">
        <SettingsSectionHeading
          title="Account overview"
          detail="Profile, plan, and allowance"
          hint="Your plan's monthly allowance pays for usage first. Anything beyond it settles from your wallet."
        />
        <AccountSummaryCard
          primary={accountName}
          accountId={adapter.accountUser?.id}
          walletDesc={linkedWalletStatus}
          tier={account?.user.tier}
          memberSince={formatMemberSince(account?.user.created_at)}
          credits={credits}
          onManageAccount={onManageAccount}
          onViewUsage={onViewUsage}
        />
      </section>

      <section className="flex flex-col gap-2">
        <SettingsSectionHeading
          title="Preferences"
          detail="Theme, network, and wallets"
        />
        <div className={settingsPanelClass}>
          <FlatSettingRow label="Theme">
            <div className="border-aomi-border bg-aomi-surface flex h-8 items-center rounded-lg border p-[3px]">
              {themeChoices.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateSetting("colorMode", mode)}
                  className={`rounded-md px-3 py-1 text-[12px] leading-none transition-colors ${
                    settings.colorMode === mode
                      ? "bg-aomi-surface-2 text-aomi-fg font-medium"
                      : "text-aomi-muted hover:text-aomi-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </FlatSettingRow>

          <Divider />

          <FlatSettingRow label="Default network">
            <div className="text-aomi-fg flex items-center gap-2 text-[13px] font-medium">
              {NetworkIcon ? (
                <NetworkIcon className="text-aomi-muted size-4 shrink-0" />
              ) : null}
              <span>{networkName ?? "—"}</span>
            </div>
          </FlatSettingRow>

          <Divider />

          <FlatSettingRow
            label="Wallets"
            hint={`${connectedWallets} connected · ${linkedWallets} linked`}
          >
            {onManageAccount ? (
              <AomiButton size="sm" onClick={onManageAccount}>
                Manage
              </AomiButton>
            ) : null}
          </FlatSettingRow>
        </div>
      </section>
    </div>
  );
}

function AccountSummaryCard({
  primary,
  accountId,
  walletDesc,
  tier,
  memberSince,
  credits,
  onManageAccount,
  onViewUsage,
}: {
  primary: string;
  accountId?: string;
  walletDesc: string;
  tier?: string;
  memberSince?: string;
  credits?: AomiCreditPosition | null;
  onManageAccount?: () => void;
  onViewUsage?: () => void;
}) {
  const allowance = creditAllowanceFromPosition(credits);
  const creditsUsed = allowance?.used ?? 0;
  const creditsIncluded = allowance?.included ?? 0;
  const remaining = Math.max(0, creditsIncluded - creditsUsed);
  const periodLabel = formatPeriodLabel(credits?.period_utc_month);
  const hasAllowance = creditsIncluded > 0;

  return (
    <div className={settingsPanelClass}>
      <SettingRow
        title={primary}
        desc={walletDesc}
        leading={<AccountAvatar seed={accountId} size={32} />}
        className="px-4 sm:px-5"
      >
        <AomiButton size="sm" onClick={onManageAccount}>
          Manage account
        </AomiButton>
      </SettingRow>

      <Divider />

      <SettingRow
        title="Plan"
        desc={
          <>
            {memberSince ? `Member since ${memberSince}` : "Account plan"}
            {/* Without an allowance row, View usage lives here instead. */}
            {!hasAllowance ? (
              <>
                {" · "}
                <ViewUsageLink onClick={onViewUsage} />
              </>
            ) : null}
          </>
        }
        className="px-4 sm:px-5"
      >
        <span className="text-aomi-fg text-[14px] font-medium">
          {tierLabel(tier)}
        </span>
      </SettingRow>

      {hasAllowance && (
        <>
          <Divider />
          <SettingRow
            title="Monthly allowance"
            desc={
              <>
                {periodLabel} · resets each UTC month
                {" · "}
                <ViewUsageLink onClick={onViewUsage} />
              </>
            }
            className="px-4 sm:px-5"
          >
            <div className="flex w-[220px] flex-col gap-1.5">
              <div className="text-aomi-muted flex justify-between text-[12px] tabular-nums">
                <span>
                  <span className="text-aomi-fg font-medium">
                    {formatAllowanceCredits(remaining)}
                  </span>{" "}
                  of {formatAllowanceCredits(creditsIncluded)} left
                </span>
                <span>{formatAllowanceCredits(creditsUsed)} used</span>
              </div>
              <Meter pct={(creditsUsed / creditsIncluded) * 100} />
            </div>
          </SettingRow>
        </>
      )}
    </div>
  );
}

function ViewUsageLink({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-aomi-accent-strong hover:text-aomi-fg font-medium transition-colors"
    >
      View usage
    </button>
  );
}

function WalletAttentionBanner({
  walletAttentionCount,
  onReview,
}: {
  walletAttentionCount: number;
  onReview?: () => void;
}) {
  return (
    <div className="border-aomi-border bg-aomi-surface-2/35 relative rounded-xl border px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <span className="bg-aomi-surface-2 text-aomi-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          <Shield size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug">
            Review wallet signing
          </h3>
          <p className="text-aomi-muted mt-1.5 text-[13px] leading-relaxed">
            {walletAttentionCount}{" "}
            {walletAttentionCount === 1 ? "wallet needs" : "wallets need"} a
            renewed provider grant before auto-signing can run.
          </p>
        </div>
        <AomiButton size="sm" onClick={onReview} className="self-start">
          Review
        </AomiButton>
      </div>
    </div>
  );
}

function FlatSettingRow({
  label,
  hint,
  hintMono,
  children,
}: {
  label: string;
  hint?: string;
  hintMono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <span className="text-[14px] font-medium leading-none">{label}</span>
        {hint && (
          <span
            className={`text-aomi-muted mt-1 block text-[12px] leading-snug [overflow-wrap:anywhere] ${
              hintMono ? "font-mono" : ""
            }`}
          >
            {hint}
          </span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function formatMemberSince(createdAt?: number): string | undefined {
  if (!createdAt) return undefined;
  return new Date(createdAt * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPeriodLabel(periodUtcMonth?: string): string {
  if (!periodUtcMonth) {
    const now = new Date();
    return now.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const [year, month] = periodUtcMonth.split("-").map(Number);
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[month - 1] ?? periodUtcMonth} ${year}`;
}
