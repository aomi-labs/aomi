"use client";

import { useMemo, type FC } from "react";
import { Wallet } from "lucide-react";
import { cn, useOptionalAomiRuntime } from "@aomi-labs/react";
import { projectCommitLifecycle } from "@aomi-labs/client";
import { useAomiWalletKit } from "@/wallet/context";
import { selectActivity } from "@/sidebar/activity/model";
import { friendlyTransactionLabel } from "@/sidebar/activity/presentation";
import {
  PhaseTrack,
  transactionProgress,
} from "@/sidebar/activity/transactions";
import { useActivityPanel } from "@/sidebar/activity/activity-panel-context";

const COMMIT_TOOLS = new Set(["evm_commit_txs", "svm_commit_txs"]);

export const isCommitTool = (toolName: string) => COMMIT_TOOLS.has(toolName);

/** The commit ids a commit tool admitted, from its result in any wire shape. */
function commitIds(result: unknown): string[] {
  const parse = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const candidates = Array.isArray(result)
    ? result.map(parse)
    : [parse(result)];
  for (const candidate of candidates) {
    const commits = (candidate as { commits?: unknown })?.commits;
    if (!Array.isArray(commits)) continue;
    const ids = commits
      .map((commit) => (commit as { commit_id?: unknown })?.commit_id)
      .filter((id): id is string => typeof id === "string");
    if (ids.length) return ids;
  }
  return [];
}

/** The last rows each commit batch showed, kept after its activity is gone. */
const lastHandoff = new Map<string, HandoffRow[]>();

type HandoffRow = ReturnType<typeof transactionProgress> & {
  tx: ReturnType<typeof selectActivity>["transactions"][number];
  confirmed: boolean;
  inWallet: boolean;
};

const WALLET_PHASES = new Set([
  "preparing",
  "switching_chain",
  "awaiting_wallet",
]);

/**
 * Under a Commit step: the batch that went to the wallet, one line per
 * transaction with the panel's phase bar, so the trace shows the hand-off
 * (sent → waiting for you → signed → confirmed) without opening the panel.
 */
export const CommitHandoff: FC<{ result: unknown }> = ({ result }) => {
  const ids = useMemo(() => new Set(commitIds(result)), [result]);
  // Optional: the trace also renders in previews and tests with no runtime.
  const runtime = useOptionalAomiRuntime();
  const events = runtime?.events;
  const pendingActions = runtime?.pendingActions;
  const commits = runtime?.commits;
  const commitController = runtime?.commitController;
  const { wallets } = useAomiWalletKit();
  const { setOpen } = useActivityPanel();

  const rows = useMemo(() => {
    if (!ids.size || !events || !pendingActions) return [];
    const activity = selectActivity(events, pendingActions, commits ?? []);
    const seen = new Map<string, (typeof activity.transactions)[number]>();
    for (const tx of [...activity.transactions, ...activity.history]) {
      if (tx.commit && ids.has(tx.commit.commit_id)) seen.set(tx.id, tx);
    }
    return [...seen.values()].sort(
      (a, b) => (a.commit?.batch?.index ?? 0) - (b.commit?.batch?.index ?? 0),
    );
  }, [ids, events, pendingActions, commits]);

  const liveRows = rows.map((tx) => {
    const progress = transactionProgress(tx);
    const phase = tx.commit
      ? projectCommitLifecycle(
          tx.commit,
          commitController?.submissionPhase?.(tx.commit.commit_id),
          commitController?.recoveryRecord?.(tx.commit.commit_id),
        ).phase
      : undefined;
    const confirmed = tx.commit?.state === "confirmed";
    return {
      tx,
      ...progress,
      confirmed,
      inWallet: Boolean(phase && WALLET_PHASES.has(phase)),
    };
  });
  // Finished commits leave the runtime's live activity; the card keeps its
  // last state so the trace still shows what went to the wallet.
  const cacheKey = [...ids].sort().join("|");
  if (liveRows.length && cacheKey) lastHandoff.set(cacheKey, liveRows);
  const states = liveRows.length ? liveRows : (lastHandoff.get(cacheKey) ?? []);
  if (!states.length) return null;
  const finished = !liveRows.length;
  const anyRejected = states.some((row) => row.rejected || row.failed);
  const allConfirmed = states.every((row) => row.confirmed);
  const allSigned = states.every((row) => row.signed);
  const waiting = !finished && !anyRejected && !allSigned;
  // The first unsigned transaction is the one the wallet asks for next.
  const nextIndex = states.findIndex((row) => !row.signed && !row.terminal);

  const family = states[0].tx.family;
  const walletName =
    wallets.find((wallet) => wallet.active && wallet.family === family)
      ?.walletName ?? "your wallet";
  const signedCount = states.filter((row) => row.signed).length;

  const title = anyRejected
    ? "Rejected in your wallet"
    : allConfirmed
      ? "Confirmed"
      : allSigned
        ? "Signed · submitting"
        : states.some((row) => row.inWallet)
          ? `Waiting for you in ${walletName}`
          : `Ready to sign in ${walletName}`;
  const detail =
    waiting && signedCount > 0
      ? `${signedCount} of ${states.length} signed`
      : `${states.length} transaction${states.length === 1 ? "" : "s"}`;

  return (
    <div
      data-testid="commit-handoff"
      className={cn(
        "bg-aomi-surface rounded-card animate-in-rise mb-1.5 ml-[26px] mt-1 flex flex-col gap-2 border px-3 py-2.5 transition-colors duration-200",
        anyRejected
          ? "border-aomi-danger/40"
          : allSigned
            ? "border-aomi-border"
            : waiting && states.some((row) => row.inWallet)
              ? "border-aomi-accent/50 border-dashed"
              : "border-aomi-muted/40 border-dashed",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <Wallet
          className={cn(
            "size-3.5 shrink-0",
            anyRejected ? "text-aomi-danger" : "text-aomi-muted",
          )}
        />
        <span className="truncate font-medium">{title}</span>
        <span className="text-aomi-muted shrink-0 tabular-nums">{detail}</span>
        <span className="flex-1" />
        {waiting ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-aomi-fg text-aomi-bg h-6 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-opacity hover:opacity-90 active:scale-[.98]"
          >
            Review
          </button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-2.5">
        {states.map((row, index) => {
          const live = waiting && index === nextIndex;
          const label = friendlyTransactionLabel(row.tx.label, row.tx.kind);
          const pending = waiting && !row.signed && !row.terminal;
          return (
            <li
              key={row.tx.id}
              className="flex min-w-0 items-center gap-2.5 text-[12.5px]"
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                  pending
                    ? "bg-aomi-accent-subtle text-aomi-accent-strong"
                    : "bg-aomi-surface-2 text-aomi-muted",
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate" title={label}>
                {label}
              </span>
              <PhaseTrack
                className="w-[232px] shrink-0"
                signature={row.tx.kind === "signature"}
                stage={row.tx.stage}
                step={row.step}
                signed={row.signed}
                rejected={row.rejected}
                failed={Boolean(row.failed)}
                liveStep={live ? (row.inWallet ? 3 : row.step) : undefined}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
};
