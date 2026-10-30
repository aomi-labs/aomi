"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getChainInfo } from "@aomi-labs/react";
import type { CreditBalance } from "@aomi-labs/client";
import { AccountAvatar } from "./account-avatar";
import { useAccountCredits } from "./use-account-credits";
import { useAomiWalletKit } from "@/wallet/context";
import { AomiButton } from "@/ui/aomi/button";
import { getChainIcon } from "@/icons/chain-map";
import { Chip } from "./usage/usage-shared";
import { useUsageStatement } from "./usage/use-usage-statement";
import { AllowanceRing } from "@/ui/aomi/allowance-ring";
import { CreditCheckoutDialog } from "./usage/credits/credit-checkout-dialog";
import { billingFromPosition, formatDollars } from "./usage/credits/format";
import { ChevronRight } from "lucide-react";
import { walletConnectionSummary } from "@/wallet/account-presentation";
import {
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
  onViewBilling,
}: {
  onManageAccount?: () => void;
  onViewBilling?: () => void;
}) {
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;
  const { settings, updateSetting } = useSettings();
  const account = useAccountOverview();
  const overviewStore = useAccountOverviewStore();
  const [overviewSettled, setOverviewSettled] = useState(false);
  const position = useAccountCredits();
  // undefined while loading; null when unavailable.
  const credits =
    position.isPending && position.fetchStatus !== "idle"
      ? undefined
      : (position.data ?? null);

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

  const wallets = adapter.wallets;
  const connectedWallets = wallets.filter((wallet) => wallet.connected).length;
  const linkedWallets = wallets.filter((wallet) => wallet.linked).length;
  const linkedWalletStatus = walletConnectionSummary(wallets);
  const accountName =
    adapter.accountUser?.displayName?.trim() ||
    adapter.accountUser?.email ||
    account?.user.verified_email ||
    "Aomi account";

  // The summary card draws from two reads; it shows once both have answered.
  // Local preferences below never wait for the account.
  const accountReady = overviewSettled && credits !== undefined;

  const themeChoices: { mode: ColorMode; label: string }[] = [
    { mode: "dark", label: "Dark" },
    { mode: "light", label: "Light" },
    { mode: "auto", label: "System" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <SettingsSectionHeading
          title="Account overview"
          detail="Profile, plan, and this month"
          hint="Your plan's monthly allowance pays for usage first. Anything beyond it comes from the funds you add."
        />
        {accountReady ? (
          <AccountSummaryCard
            primary={accountName}
            accountId={adapter.accountUser?.id}
            walletDesc={linkedWalletStatus}
            tier={account?.user.tier}
            memberSince={formatMemberSince(account?.user.created_at)}
            credits={credits}
            onManageAccount={onManageAccount}
            onViewBilling={onViewBilling}
          />
        ) : (
          <div className={settingsPanelClass}>
            <LoadingPane label="Loading account overview" />
          </div>
        )}
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
  onViewBilling,
}: {
  primary: string;
  accountId?: string;
  walletDesc: string;
  tier?: string;
  memberSince?: string;
  credits?: CreditBalance | null;
  onManageAccount?: () => void;
  onViewBilling?: () => void;
}) {
  const billing = billingFromPosition(credits);
  const month = useUsageStatement().month;
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const position = useAccountCredits();
  const turns = month?.apps.reduce((sum, app) => sum + app.model.turns, 0) ?? 0;
  const calls =
    month?.apps.reduce((sum, app) => sum + (app.tool?.calls ?? 0), 0) ?? 0;

  return (
    <div className={settingsPanelClass}>
      <SettingRow
        title={primary}
        desc={[walletDesc, memberSince && `member since ${memberSince}`]
          .filter(Boolean)
          .join(" · ")}
        leading={<AccountAvatar seed={accountId} size={32} />}
        className="px-4 sm:px-5"
      >
        <Chip>{`${tierLabel(tier)} plan`}</Chip>
        <AomiButton size="sm" onClick={onManageAccount}>
          Manage account
        </AomiButton>
      </SettingRow>

      {billing ? (
        <>
          <Divider />
          <div className="divide-aomi-border grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="flex items-center gap-3.5 px-4 py-4 sm:px-5">
              {billing.allowanceUsd > 0 ? (
                <AllowanceRing left={billing.allowanceLeft} size={44} />
              ) : null}
              <Stat
                label="Monthly allowance"
                value={
                  billing.allowanceUsd > 0 ? (
                    <>
                      {formatDollars(billing.allowanceLeftUsd)}{" "}
                      <span className="text-aomi-muted text-[12px] font-normal">
                        of {formatDollars(billing.allowanceUsd)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )
                }
                detail={
                  billing.allowanceUsd > 0
                    ? `Resets ${billing.resetsOn}`
                    : "Not on this plan"
                }
              />
            </div>
            <div className="px-4 py-4 sm:px-5">
              <Stat
                label="Added balance"
                value={formatDollars(billing.balanceUsd)}
                detail="Never expires"
              />
            </div>
            <div className="px-4 py-4 sm:px-5">
              <Stat
                label={
                  month
                    ? `Spent in ${month.period.periodLabel.split(" ")[0]}`
                    : "Spent this month"
                }
                value={month ? formatDollars(month.summary.totalUsd) : "—"}
                detail={
                  month ? `${turns} turns · ${calls} tool calls` : "Loading…"
                }
              />
            </div>
          </div>
          <Divider />
          <div className="bg-aomi-surface flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
            <span className="type-meta text-aomi-muted">
              Your allowance is used first, then your added balance.
            </span>
            <div className="flex gap-2">
              <AomiButton size="sm" onClick={() => setCheckoutOpen(true)}>
                Add funds
              </AomiButton>
              <AomiButton size="sm" onClick={onViewBilling}>
                Billing
                <ChevronRight />
              </AomiButton>
            </div>
          </div>
          <CreditCheckoutDialog
            open={checkoutOpen}
            onClose={() => setCheckoutOpen(false)}
            onSuccess={async () => {
              await position.refetch();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="type-meta text-aomi-muted">{label}</span>
      <span className="text-[16px] font-semibold tabular-nums leading-6 tracking-[-0.01em]">
        {value}
      </span>
      <span className="type-meta text-aomi-muted truncate">{detail}</span>
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
