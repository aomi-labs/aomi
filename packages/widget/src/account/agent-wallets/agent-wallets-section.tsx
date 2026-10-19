"use client";

import { lazy, Suspense, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { AomiAgentWallet, AomiAgentWallets } from "@aomi-labs/client";
import { cn, useDisplayQuery } from "@aomi-labs/react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { AomiButton } from "@/ui/aomi/button";
import { ConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { Switch } from "@/ui/aomi/switch";
import { SheetHeader } from "@/wallet/picker/sheet-parts";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { useShellTransport } from "@/account/transport";
import { agentWalletsQuery } from "@/account/account-queries";
import { ActionsMenu, Divider } from "@/account/account-management/controls";
import { AgentWalletRow, type AgentWalletActions } from "./agent-wallet-row";
import { holdsFunds, shownWallets, walletRows } from "./agent-wallet-model";
import { useRefreshWallets } from "./use-refresh-wallets";

// Opened on demand, so they (and the QR encoder) load only then.
const AgentWalletDetails = lazy(() =>
  import("./agent-wallet-details").then((module) => ({
    default: module.AgentWalletDetails,
  })),
);
const AgentWalletWithdraw = lazy(() =>
  import("./agent-wallet-withdraw").then((module) => ({
    default: module.AgentWalletWithdraw,
  })),
);

type Sheet =
  | { kind: "details" | "withdraw"; wallet: AomiAgentWallet }
  | { kind: "all" }
  | { kind: "archive"; wallet: AomiAgentWallet; funded: boolean };

const ERRORS: Record<string, string> = {
  rule_version_conflict:
    "Your agent wallets changed in another tab. Try again.",
  portal_session_required: "Sign in on Aomi to change agent wallets.",
};

/**
 * Settings › Account › Agent wallets: the band at the bottom of Wallets &
 * access. The three most recently used wallets (the active one always in),
 * "Show all N" for the rest, and archived ones collapsed. Pause all lives on
 * the band's ⋯ and in the Show all sheet.
 */
export function AgentWalletsSection({
  rows,
  pending: kitPending,
  onActivate,
  onUse,
}: {
  /** The wallet kit's rows; agent rows carry Active and the pick. */
  rows: readonly WalletRow[];
  /** A wallet-kit step in flight (activating a row). */
  pending: string | null;
  onActivate?: (row: WalletRow) => void;
  onUse?: (rows: WalletRow[]) => void;
}) {
  const { client } = useShellTransport();
  const query = useDisplayQuery(agentWalletsQuery(client));
  const refresh = useRefreshWallets();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const data = query.data;
  const pending = busy ?? kitPending;

  const run = async (key: string, write: () => Promise<unknown>) => {
    if (pending) return false;
    setBusy(key);
    setError(null);
    try {
      await write();
      await Promise.all([refresh(), query.refetch()]);
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
    change: Parameters<typeof client.account.wallets.updateAgentWallet>[1],
  ) =>
    run(`agent:${wallet.id}`, () =>
      client.account.wallets.updateAgentWallet(wallet.id, change),
    );
  const pauseAll = (paused: boolean, list: AomiAgentWallets) =>
    void run("agent:all", () =>
      client.account.wallets.setAgentRule({
        locked: paused,
        version: list.version,
      }),
    );
  const archive = async (wallet: AomiAgentWallet) => {
    if (pending) return;
    setBusy(`agent:${wallet.id}`);
    const balances = await Promise.all(
      wallet.addresses.map(({ family }) =>
        client.account.wallets
          .agentWalletBalances(wallet.id, family)
          .catch(() => ({ networks: [] })),
      ),
    );
    setBusy(null);
    setSheet({ kind: "archive", wallet, funded: holdsFunds(balances) });
  };

  const actions: AgentWalletActions = {
    onDetails: (wallet) => setSheet({ kind: "details", wallet }),
    onUse,
    onWithdraw: (wallet) => setSheet({ kind: "withdraw", wallet }),
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
  const shown = shownWallets(live, (wallet) =>
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
  const current =
    sheet && sheet.kind !== "all"
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
            : "Hosted by Aomi · it signs when a connection is allowed to"
        }
        action={
          data.wallets.length ? (
            <ActionsMenu
              label="Actions for agent wallets"
              disabled={pending !== null}
              busy={busy === "agent:all"}
              items={[
                data.pause_all
                  ? {
                      label: "Resume all",
                      onSelect: () => pauseAll(false, data),
                    }
                  : {
                      label: "Pause all",
                      detail: "Nothing signs until you resume",
                      onSelect: () => pauseAll(true, data),
                    },
                ...(live.length
                  ? [
                      {
                        label: `Show all ${live.length}`,
                        onSelect: () => setSheet({ kind: "all" }),
                      },
                    ]
                  : []),
              ]}
            />
          ) : undefined
        }
      />
      {error ? (
        <p role="alert" className="type-meta text-aomi-danger px-3.5 pt-2">
          {error}
        </p>
      ) : null}
      {shown.map(row)}
      {live.length > shown.length ? (
        <button
          type="button"
          onClick={() => setSheet({ kind: "all" })}
          className="border-aomi-border text-aomi-accent-strong hover:bg-aomi-hover type-control flex min-h-11 w-full items-center justify-center border-t outline-none transition-colors"
        >
          Show all {live.length} agent wallets
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
              {archived.length} {archived.length === 1 ? "wallet" : "wallets"} ·
              hidden from chats and connections
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

      {sheet?.kind === "all" ? (
        <AllAgentWallets
          wallets={live}
          pausedAll={data.pause_all}
          busy={busy === "agent:all"}
          onPauseAll={(paused) => pauseAll(paused, data)}
          onClose={() => setSheet(null)}
          renderRow={row}
        />
      ) : null}
      <Suspense fallback={null}>
        {sheet?.kind === "details" && current ? (
          <AgentWalletDetails
            wallet={current}
            onClose={() => setSheet(null)}
            onWithdraw={() => setSheet({ kind: "withdraw", wallet: current })}
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
                It still holds funds. Withdraw keeps working after you archive.
              </span>
              <AomiButton
                size="sm"
                onClick={() =>
                  setSheet({ kind: "withdraw", wallet: sheet.wallet })
                }
              >
                Withdraw first
              </AomiButton>
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** "Show all N": every unarchived wallet with search, and Pause all. */
function AllAgentWallets({
  wallets,
  pausedAll,
  busy,
  onPauseAll,
  onClose,
  renderRow,
}: {
  wallets: readonly AomiAgentWallet[];
  pausedAll: boolean;
  busy: boolean;
  onPauseAll: (paused: boolean) => void;
  onClose: () => void;
  renderRow: (wallet: AomiAgentWallet) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matches = wallets.filter(
    (wallet) =>
      !needle ||
      wallet.name.toLowerCase().includes(needle) ||
      wallet.app?.label.toLowerCase().includes(needle) ||
      wallet.addresses.some((address) =>
        address.address.toLowerCase().includes(needle),
      ),
  );
  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        title="Agent wallets"
        description={`${wallets.length} wallets · most recently used first`}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
        <ListGroup>
          <ListRow
            title="Pause all"
            description="Nothing signs from any agent wallet until you resume"
            trailing={
              <Switch
                aria-label="Pause all agent wallets"
                checked={pausedAll}
                disabled={busy}
                onCheckedChange={onPauseAll}
              />
            }
          />
        </ListGroup>
        <label className="border-aomi-border rounded-control focus-within:border-aomi-muted flex h-9 items-center gap-2 border px-3">
          <Search className="text-aomi-muted size-4 shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, app or address"
            aria-label="Search agent wallets"
            className="type-control text-aomi-fg placeholder:text-aomi-muted min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
        <div className="border-aomi-border bg-aomi-raised rounded-card overflow-hidden border">
          {matches.length ? (
            matches.map(renderRow)
          ) : (
            <p className="type-control text-aomi-muted px-3.5 py-3">
              No agent wallet matches.
            </p>
          )}
        </div>
      </div>
    </AomiSheet>
  );
}
