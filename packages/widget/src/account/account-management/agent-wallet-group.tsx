"use client";

import { lazy, Suspense, useState } from "react";
import { cn, useOptionalAomiRuntime } from "@aomi-labs/react";
import {
  shortAddress,
  type AomiAccountWallet,
  type AomiClient,
  type AomiWalletBalance,
  type AomiWalletFamily,
} from "@aomi-labs/client";
import { Loader2, Plus } from "lucide-react";
import { aomiButton } from "@/ui/aomi/button";
import { PendingMark, StatusPill } from "@/ui/aomi/status-pill";
import { explorerUrl } from "@/thread/explorer-links";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { useAomiWalletKit } from "@/wallet/context";
import {
  ActionsMenu,
  BrandMark,
  CopyButton,
  Divider,
  type MenuItem,
} from "./controls";
import { AGENT_WALLET, familyTag } from "./wallet-model";
import { useAgentWallets, useWalletBalance } from "./use-agent-wallets";

// The sheet and its QR encoder load on first open, off the Settings bundle.
const DepositSheet = lazy(() =>
  import("./deposit-sheet").then((module) => ({
    default: module.DepositSheet,
  })),
);

export type AgentWalletHandlers = {
  /** Rename by the list's `w_` id; resolves false when it did not save. */
  onRename?: (
    wallet: AomiAccountWallet,
    label: string | null,
  ) => Promise<boolean>;
  /** Start a new chat that withdraws from this wallet. */
  onWithdraw?: (wallet: AomiAccountWallet, row: WalletRow | undefined) => void;
  /**
   * Settings' action runner: one action at a time, its failure shown in
   * Settings' banner. Rename and Withdraw run through it by default.
   */
  run?: (
    key: string,
    action: () => Promise<unknown>,
    refresh?: boolean,
  ) => Promise<boolean>;
  /** Closes Settings once Withdraw to… has opened its chat. */
  onClose?: () => void;
  /** The client Settings reads the account through. */
  client?: AomiClient;
};

/** Rename through the account graph and Withdraw into a new chat. */
function useWalletActions(
  run: AgentWalletHandlers["run"],
  onClose: (() => void) | undefined,
  client: AomiClient | undefined,
): Pick<AgentWalletHandlers, "onRename" | "onWithdraw"> {
  const kit = useAomiWalletKit();
  const runtime = useOptionalAomiRuntime();
  if (!run) return {};
  const rename = kit.updateLinkedWallet;
  const activate = kit.activateWallet;
  return {
    onRename: rename
      ? (wallet, label) =>
          run(`rename:${wallet.id}`, () =>
            rename({ walletId: wallet.id, label }).catch((cause: unknown) => {
              throw new Error(renameFailure(cause));
            }),
          )
      : undefined,
    onWithdraw: runtime
      ? (wallet, row) => {
          void run(
            `withdraw:${wallet.id}`,
            async () => {
              if (
                !row ||
                !activate ||
                !client ||
                `w_${row.linkedWalletId}` !== wallet.id ||
                (await activate(row.key)) !== "active"
              ) {
                throw new Error("Wallet unavailable. Refresh and retry.");
              }
              const threadId = await runtime.createThread({
                draft: `Send all funds from ${wallet.label} to `,
              });
              const selected = await client.account.wallets.setThreadWallet(
                threadId,
                wallet.id,
              );
              if (selected.active_wallet[wallet.family] !== wallet.id)
                throw new Error("Wallet unavailable. Refresh and retry.");
              onClose?.();
            },
            false,
          );
        }
      : undefined,
  };
}

function renameFailure(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  if (code === "label_too_long") return "Names can be up to 40 characters.";
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

type GroupProps = AgentWalletHandlers & {
  /** The wallet kit's rows; agent rows carry Active and the pick. */
  rows: readonly WalletRow[];
  pending: string | null;
  onActivate?: (row: WalletRow) => void;
};

/** The kit row of a listed wallet (`w_<id>` ↔ the account graph's id). */
const kitRow = (rows: readonly WalletRow[], wallet: AomiAccountWallet) =>
  rows.find(
    (row) => row.linkedWalletId && `w_${row.linkedWalletId}` === wallet.id,
  );

/**
 * Settings › Wallets & access › Agent wallet: the account's agent wallets,
 * their balances, Deposit, and the pick for chat. Shown once loaded.
 */
export function AgentWalletGroup({
  rows,
  pending,
  onActivate,
  run,
  onClose,
  client,
  ...handlers
}: GroupProps) {
  const defaults = useWalletActions(run, onClose, client);
  const onRename = handlers.onRename ?? defaults.onRename;
  const onWithdraw = handlers.onWithdraw ?? defaults.onWithdraw;
  const agents = useAgentWallets(client);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string[]>([]);
  if (agents.status === "loading") return null;

  const create = async () => {
    setCreating(true);
    setCreateError([]);
    try {
      const result = await agents.create(["evm", "svm"]);
      setCreateError(
        result.failed.map(
          (failure) =>
            `${familyName(failure.family)} wallet couldn’t be created. Try again.`,
        ),
      );
    } catch (cause) {
      setCreateError([createFailure(cause)]);
    } finally {
      setCreating(false);
    }
  };

  const wallets = agents.wallets ?? [];
  const companion = (wallet: AomiAccountWallet) =>
    wallet.is_default
      ? wallets.find(
          (other) => other.is_default && other.family !== wallet.family,
        )
      : undefined;

  return (
    <div data-agent-wallets>
      <Divider
        title="Agent wallet"
        detail="Funds Aomi can trade with on your behalf"
      />
      {agents.status === "error" ? (
        <p className="type-control text-aomi-muted px-3.5 py-3">
          Couldn’t load your agent wallets.
        </p>
      ) : wallets.length ? (
        <div className="divide-aomi-border divide-y">
          {wallets.map((wallet) => (
            <AgentWalletRow
              key={wallet.id}
              wallet={wallet}
              companion={companion(wallet)}
              row={kitRow(rows, wallet)}
              client={client}
              pending={pending}
              onActivate={onActivate}
              onRename={
                onRename
                  ? async (target, label) => {
                      const saved = await onRename(target, label);
                      if (saved) await agents.refresh();
                      return saved;
                    }
                  : undefined
              }
              onWithdraw={onWithdraw}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-14 flex-wrap items-center gap-3 py-3 pl-3.5 pr-3 sm:flex-nowrap">
          <BrandMark brand={AGENT_WALLET} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="type-row">No agent wallet yet</span>
            <span className="type-meta text-aomi-muted">
              One EVM and one Solana address that Aomi signs from. Each trade
              asks first.
            </span>
          </span>
          <button
            type="button"
            disabled={creating || pending !== null}
            onClick={() => void create()}
            className={aomiButton({ variant: "secondary", size: "sm" })}
          >
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
            Create agent wallet
          </button>
        </div>
      )}
      {createError.length ? (
        <div role="alert" className="flex flex-col gap-0.5 px-3.5 pb-3">
          {createError.map((message) => (
            <p key={message} className="type-meta text-aomi-danger">
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One agent wallet: name, address and chains, balance, Deposit, Active, ···. */
export function AgentWalletRow({
  wallet,
  companion,
  row,
  client,
  pending,
  onActivate,
  onRename,
  onWithdraw,
}: AgentWalletHandlers & {
  wallet: AomiAccountWallet;
  /** The other family's default, offered as a deposit tab. */
  companion?: AomiAccountWallet;
  row?: WalletRow;
  client?: AomiClient;
  pending: string | null;
  onActivate?: (row: WalletRow) => void;
}) {
  const balance = useWalletBalance(client, wallet.id);
  const [depositing, setDepositing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const short = shortAddress(wallet.address);
  const active = Boolean(row?.active);
  const busy = row !== undefined && (pending?.endsWith(`:${row.key}`) ?? false);
  const locked = pending !== null;
  const badge = wallet.bound_app?.label || (wallet.merged ? "Merged" : null);
  const explorer = walletExplorer(wallet, balance.data);
  const use = row && !active && onActivate ? () => onActivate(row) : undefined;

  const save = async () => {
    if (draft === null || !onRename) return;
    if (await onRename(wallet, draft.trim() || null)) setDraft(null);
  };

  const items: MenuItem[] = [];
  if (use) items.push({ label: "Use this wallet", onSelect: use });
  items.push({ label: "Deposit", onSelect: () => setDepositing(true) });
  if (onWithdraw)
    items.push({
      label: "Withdraw to…",
      detail: "Starts a chat that sends from this wallet",
      onSelect: () => onWithdraw(wallet, row),
    });
  if (onRename)
    items.push({
      label: "Rename",
      onSelect: () => setDraft(wallet.custom_label ?? ""),
    });
  if (explorer) items.push({ label: "View on explorer", href: explorer });

  const content = (
    <>
      <BrandMark
        brand={AGENT_WALLET}
        dot={wallet.status === "paused" ? "off" : "on"}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        {draft !== null ? (
          <input
            autoFocus
            value={draft}
            maxLength={40}
            placeholder={wallet.label}
            aria-label={`Name for ${short}`}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape") setDraft(null);
            }}
            className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted type-row rounded-control h-7 w-full max-w-56 border px-2 outline-none transition-colors"
          />
        ) : (
          <span className="type-row flex min-w-0 items-center gap-1.5">
            <span className="truncate">{wallet.label}</span>
            {badge ? <StatusPill>{badge}</StatusPill> : null}
            {wallet.status === "paused" ? (
              <StatusPill tone="warning">Paused</StatusPill>
            ) : null}
          </span>
        )}
        <span className="type-address text-aomi-muted truncate">
          {short}
          <span className="font-sans">
            {" "}
            · {chainsLine(wallet, balance.data)}
          </span>
        </span>
      </span>
    </>
  );
  const mainClass =
    "flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pl-3.5 pr-2 text-left outline-none";

  return (
    <div
      data-agent-wallet={wallet.id}
      data-active={active || undefined}
      className={cn(
        "group relative flex min-h-14 items-center transition-colors",
        active
          ? "bg-aomi-success/[0.045]"
          : use &&
              "hover:bg-aomi-hover has-[:focus-visible]:ring-aomi-accent-strong/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset",
      )}
    >
      {active ? (
        <span
          className="bg-aomi-success absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full"
          aria-hidden="true"
        />
      ) : null}
      {use && draft === null ? (
        <button
          type="button"
          aria-label={`Use ${wallet.label} ${short}`}
          data-row-main
          disabled={locked}
          onClick={use}
          className={cn(mainClass, "disabled:cursor-default")}
        >
          {content}
        </button>
      ) : (
        <div className={mainClass}>{content}</div>
      )}
      <div className="flex shrink-0 items-center gap-1 pr-3">
        <span
          data-balance
          className="type-control text-aomi-fg mr-1 hidden tabular-nums sm:inline"
          title={balanceTitle(balance.data)}
        >
          {formatUsd(balance.data?.total_usd)}
        </span>
        <button
          type="button"
          disabled={locked}
          onClick={() => setDepositing(true)}
          className={cn(
            aomiButton({ variant: "secondary", size: "sm" }),
            "mr-1",
          )}
        >
          Deposit
        </button>
        {busy ? (
          <PendingMark className="mx-2" />
        ) : active ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : null}
        <CopyButton
          value={wallet.address}
          label={`Copy address ${wallet.address}`}
        />
        <ActionsMenu
          label={`Actions for ${wallet.label} ${short}`}
          items={items}
          disabled={locked}
        />
      </div>
      {depositing ? (
        <Suspense fallback={null}>
          <DepositSheet
            wallet={wallet}
            companion={companion}
            client={client}
            onClose={() => {
              setDepositing(false);
              void balance.refetch();
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

const familyName = (family: AomiWalletFamily) =>
  family === "evm" ? "EVM" : "Solana";

/** `EVM · Base, Ethereum, Robinhood…` from the balance, or the SVM gas note. */
export function chainsLine(
  wallet: Pick<AomiAccountWallet, "family">,
  balance?: AomiWalletBalance,
): string {
  if (wallet.family === "svm") return "SVM · pays its own SOL gas";
  const names = (balance?.chains ?? []).map((chain) => chain.name);
  if (!names.length) return familyTag("evm");
  const shown = names.slice(0, 3).join(", ");
  return `EVM · ${shown}${names.length > 3 ? "…" : ""}`;
}

/** `$412.80`, or "—" when no USD value is known. */
export function formatUsd(value: string | null | undefined): string {
  const amount = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function balanceTitle(balance?: AomiWalletBalance): string | undefined {
  const unread = balance?.chains.filter((chain) => chain.error) ?? [];
  return unread.length
    ? `Couldn’t read ${unread.map((chain) => chain.name).join(", ")}`
    : undefined;
}

function walletExplorer(
  wallet: AomiAccountWallet,
  balance?: AomiWalletBalance,
): string | null {
  if (wallet.family === "svm")
    return explorerUrl("mainnet-beta", "address", wallet.address);
  const chains = (balance?.chains ?? []).map((chain) => Number(chain.chain));
  const chainId = chains.includes(8453) ? 8453 : (chains[0] ?? 1);
  return (
    explorerUrl(chainId, "address", wallet.address) ??
    explorerUrl(1, "address", wallet.address)
  );
}

function createFailure(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  if (code === "guest_account") return "Sign in to create an agent wallet.";
  if (code === "agent_wallet_unavailable")
    return "Agent wallets aren’t available right now.";
  return "Couldn’t create your agent wallet. Try again.";
}
