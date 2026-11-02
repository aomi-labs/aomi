"use client";

import { cn } from "@/lib/cn";
import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AomiAgentWallet } from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { AomiButton } from "@/ui/aomi/button";
import { ConfirmDialog } from "@/ui/aomi/confirm-dialog";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { useShellAomi } from "@/account/transport";
import { agentWalletsQuery } from "@/account/account-queries";
import { Divider } from "@/account/account-management/controls";
import { plural } from "@/account/account-management/wallet-model";
import { AgentWalletRow, type AgentWalletActions } from "./agent-wallet-row";
import {
  SHOWN_AGENT_WALLETS,
  holdsFunds,
  shownWallets,
  walletRows,
} from "./agent-wallet-model";
import { useRefreshWallets } from "./use-refresh-wallets";

// Opened on demand, so they (and the QR encoder) load only then.
const AgentWalletManage = lazy(() =>
  import("./agent-wallet-manage").then((module) => ({
    default: module.AgentWalletManage,
  })),
);
const AgentWalletWithdraw = lazy(() =>
  import("./agent-wallet-withdraw").then((module) => ({
    default: module.AgentWalletWithdraw,
  })),
);

type Sheet =
  | { kind: "manage" | "withdraw"; wallet: AomiAgentWallet }
  | { kind: "archive"; wallet: AomiAgentWallet; funded: boolean };

const ERRORS: Record<string, string> = {
  rule_version_conflict:
    "Your agent wallets changed in another tab. Try again.",
  portal_session_required: "Sign in on Aomi to change agent wallets.",
};

/**
 * Settings › Account › Agent wallets: the band at the bottom of Wallets &
 * access. The three most recently used wallets (the active one always in),
 * "Show all N" under them to list the rest in place, and archived ones
 * collapsed.
 */
export function AgentWalletsSection({
  rows,
  pending: kitPending,
  onActivate,
}: {
  /** The wallet kit's rows; agent rows carry Active and the pick. */
  rows: readonly WalletRow[];
  /** A wallet-kit step in flight (activating a row). */
  pending: string | null;
  onActivate?: (row: WalletRow) => void;
}) {
  const aomi = useShellAomi();
  const query = useDisplayQuery(agentWalletsQuery(aomi));
  const refresh = useRefreshWallets();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const data = query.data;
  const pending = busy ?? kitPending;

  const run = async (key: string, write: () => Promise<unknown>) => {
    if (pending) return false;
    setBusy(key);
    setError(null);
    try {
      await write();
      await refresh();
      return true;
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? "";
      setError(
        code === "agent_wallet_busy"
          ? "A trade from this wallet is still in flight. Archive it once that settles."
          : (ERRORS[code] ?? "Couldn’t save that. Try again."),
      );
      return false;
    } finally {
      setBusy(null);
    }
  };
  const update = (
    wallet: AomiAgentWallet,
    change: Parameters<typeof aomi.account.wallets.updateAgentWallet>[1],
  ) =>
    run(`agent:${wallet.id}`, () =>
      aomi.account.wallets.updateAgentWallet(wallet.id, change),
    );
  const resumeAll = () =>
    void run("agent:all", () => aomi.account.wallets.pauseAll(false));
  const archive = async (wallet: AomiAgentWallet) => {
    if (pending) return;
    setBusy(`agent:${wallet.id}`);
    const balances = await Promise.all(
      wallet.addresses.map(({ family }) =>
        aomi.account.wallets
          .agentWalletBalances(wallet.id, family)
          .catch(() => ({ networks: [] })),
      ),
    );
    setBusy(null);
    setSheet({ kind: "archive", wallet, funded: holdsFunds(balances) });
  };

  const actions: AgentWalletActions = {
    onManage: (wallet) => setSheet({ kind: "manage", wallet }),
    onRename: (wallet, name) => update(wallet, { name }),
    onPause: (wallet, paused) => void update(wallet, { paused }),
    onArchive: (wallet, archived) =>
      void (archived ? archive(wallet) : update(wallet, { archived: false })),
  };

  if (!data)
    return (
      <div data-agent-wallets>
        <Divider title="Agent wallets" detail="Hosted by Aomi" />
        <p className="type-control text-aomi-muted px-3.5 py-3">
          Couldn’t load your agent wallets.
        </p>
      </div>
    );

  const live = data.wallets.filter((wallet) => wallet.archived_at === null);
  const archived = data.wallets.filter((wallet) => wallet.archived_at !== null);
  const shown = allOpen
    ? live
    : shownWallets(live, (wallet) =>
        walletRows(wallet, rows).some((row) => row.active),
      );
  const row = (wallet: AomiAgentWallet) => (
    <AgentWalletRow
      key={wallet.id}
      wallet={wallet}
      rows={walletRows(wallet, rows)}
      pausedAll={data.pause_all}
      pending={pending}
      onActivate={onActivate}
      {...actions}
    />
  );
  const current = sheet
    ? (data.wallets.find((wallet) => wallet.id === sheet.wallet.id) ??
      sheet.wallet)
    : undefined;

  return (
    <div data-agent-wallets data-paused={data.pause_all || undefined}>
      <Divider
        title="Agent wallets"
        detail={
          data.pause_all
            ? "Hosted by Aomi · all paused, nothing signs"
            : "Hosted by Aomi · each connection has a lane on it"
        }
        action={
          // An account paused as a whole can still resume.
          data.pause_all ? (
            <button
              type="button"
              disabled={pending !== null}
              onClick={resumeAll}
              className="type-meta text-aomi-accent-strong hover:text-aomi-fg rounded-[6px] px-1.5 py-1 font-medium outline-none transition-colors focus-visible:ring-2 disabled:opacity-50"
            >
              {busy === "agent:all" ? "Resuming…" : "Resume all"}
            </button>
          ) : undefined
        }
      />
      {error ? (
        <p role="alert" className="type-meta text-aomi-danger px-3.5 pt-2">
          {error}
        </p>
      ) : null}
      {shown.map(row)}
      {live.length > SHOWN_AGENT_WALLETS ? (
        <button
          type="button"
          aria-expanded={allOpen}
          onClick={() => setAllOpen((open) => !open)}
          className="border-aomi-border text-aomi-accent-strong hover:bg-aomi-hover type-control flex min-h-11 w-full items-center justify-center border-t font-medium outline-none transition-colors"
        >
          {allOpen ? "Show fewer" : `Show all ${live.length} agent wallets`}
        </button>
      ) : null}
      {!live.length ? (
        <p className="type-control text-aomi-muted px-3.5 py-3">
          None yet. Create one with Add a wallet.
        </p>
      ) : null}
      {archived.length ? (
        <>
          <button
            type="button"
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((open) => !open)}
            className="border-aomi-border bg-aomi-surface-2/60 hover:bg-aomi-hover flex w-full items-baseline gap-2 border-t px-3.5 py-1.5 text-left outline-none"
          >
            <span className="type-meta text-aomi-fg font-medium">Archived</span>
            <span className="type-meta text-aomi-muted truncate">
              {plural(archived.length, "wallet")} · hidden from chats and
              connections
            </span>
            <ChevronDown
              className={cn(
                "text-aomi-muted ml-auto size-3.5 self-center transition-transform",
                archivedOpen && "rotate-180",
              )}
            />
          </button>
          {archivedOpen ? archived.map(row) : null}
        </>
      ) : null}

      <Suspense fallback={null}>
        {sheet?.kind === "manage" && current ? (
          <AgentWalletManage
            wallet={current}
            pausedAll={data.pause_all}
            pending={pending !== null}
            onClose={() => setSheet(null)}
            onSend={() => setSheet({ kind: "withdraw", wallet: current })}
            onRename={actions.onRename}
            onPause={(paused) => actions.onPause(current, paused)}
            onArchive={(archive) => actions.onArchive(current, archive)}
          />
        ) : null}
        {sheet?.kind === "withdraw" && current ? (
          <AgentWalletWithdraw
            wallet={current}
            rows={rows}
            onClose={() => setSheet(null)}
          />
        ) : null}
      </Suspense>
      {sheet?.kind === "archive" ? (
        <ConfirmDialog
          open
          title={`Archive "${sheet.wallet.name}"?`}
          description="It’s hidden from chats and connections, and nothing signs with it. Restore it any time."
          confirmLabel="Archive"
          onOpenChange={(open) => !open && setSheet(null)}
          onConfirm={() =>
            void update(sheet.wallet, { archived: true }).then(() =>
              setSheet(null),
            )
          }
        >
          {sheet.funded ? (
            <div className="rounded-control bg-aomi-surface-2 flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="type-meta text-aomi-muted">
                It still holds funds. Send keeps working after you archive.
              </span>
              <AomiButton
                size="sm"
                onClick={() =>
                  setSheet({ kind: "withdraw", wallet: sheet.wallet })
                }
              >
                Send first
              </AomiButton>
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
