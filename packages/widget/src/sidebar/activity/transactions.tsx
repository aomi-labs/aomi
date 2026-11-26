"use client";

import { cn } from "@/lib/cn";
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  Circle,
  FileSignature,
  Layers3,
  PenLine,
} from "lucide-react";
import { getChainInfo } from "@aomi-labs/react";
import { getChainIcon } from "@/icons/chain-map";
import { SolanaIcon } from "@/icons/chain-icons";
import { StatusPill } from "@/ui/aomi/status-pill";
import {
  normalizeSolanaCluster,
  projectCommitLifecycle,
  type CommitPresentation,
} from "@aomi-labs/client";
import { explorerUrl } from "@/thread/explorer-links";
import type { ActivityTransaction } from "./model";
import {
  focusRing,
  friendlyTransactionLabel,
  transactionTitle,
  solanaNetworkName,
  transactionSemantic,
} from "./presentation";

export function TransactionList({
  children,
  newestId,
  count,
}: {
  children: ReactNode;
  newestId?: string;
  count: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);
  const reduceMotion = useReducedMotion();
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = 0;
    }
  }, [newestId]);
  const update = () => {
    const el = ref.current;
    if (!el) return;
    // Layout height, not scrollHeight: a card still sliding in (translateY)
    // inflates scrollHeight, and nothing re-measures once it settles.
    const content =
      (el.firstElementChild as HTMLElement | null)?.offsetHeight ??
      el.scrollHeight;
    setEdges({
      top: el.scrollTop > 2,
      bottom: content - el.clientHeight - el.scrollTop > 2,
    });
  };
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [children]);
  return (
    <div>
      <div className="relative">
        <m.div
          ref={ref}
          initial={false}
          animate={{
            height: Math.max(
              0,
              (showAll ? count : Math.min(3, count)) * 94 - 10,
            ),
          }}
          transition={{ duration: reduceMotion ? 0 : 0.26, ease: "easeOut" }}
          onScroll={update}
          tabIndex={0}
          role="region"
          aria-label="Transactions, newest batch first; signing order within each batch"
          // Outlines paint above the cards; an inset ring would sit under them.
          className="aui-current-transactions rounded-card focus-visible:outline-aomi-ring/50 overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          <div className="space-y-2.5">
            <AnimatePresence>{children}</AnimatePresence>
          </div>
        </m.div>
        <div
          aria-hidden="true"
          data-scroll-fade="top"
          className={cn(
            "from-aomi-raised rounded-t-card pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b to-transparent transition-opacity motion-reduce:transition-none",
            edges.top ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden="true"
          data-scroll-fade="bottom"
          className={cn(
            "from-aomi-raised rounded-b-card pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t to-transparent transition-opacity motion-reduce:transition-none",
            edges.bottom ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
      {count > 3 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => {
            if (ref.current) ref.current.scrollTop = 0;
            setShowAll(!showAll);
          }}
          className={cn(
            focusRing,
            "type-meta text-aomi-muted hover:text-aomi-fg rounded-control mt-2 flex items-center gap-2 px-1.5 py-1 transition-colors motion-reduce:transition-none",
          )}
        >
          <span aria-hidden="true">⋯</span>
          {showAll
            ? "Show fewer transactions"
            : `Show all ${count} transactions`}
        </button>
      )}
    </div>
  );
}

/** Where a transaction stands, shared by its card, its History row and the
 * panel's To sign / History split. */
export function transactionProgress(tx: ActivityTransaction) {
  const step = tx.stage === "staged" ? 0 : tx.stage === "committed" ? 2 : 1;
  const commitSigned =
    tx.commit?.state === "awaiting_broadcast" ||
    tx.commit?.state === "submitted" ||
    tx.commit?.state === "confirmed";
  const result = tx.action?.result;
  const leg =
    result?.status === "submitted"
      ? result.legs.find((leg) => leg.id === `leg_${(tx.actionIndex ?? 0) + 1}`)
      : undefined;
  const signed =
    commitSigned ||
    leg?.status === "submitted" ||
    (result?.status === "signed" && result.outputs.length > 0);
  const rejected =
    tx.commit?.state === "rejected" ||
    leg?.status === "rejected" ||
    result?.status === "rejected" ||
    tx.action?.state === "rejected";
  const failed =
    tx.commit?.state === "failed" ||
    tx.commit?.state === "expired" ||
    tx.stage === "simulation-failed" ||
    (tx.action?.request.type !== "sign" &&
      (tx.action?.request.simulation.status === "failed" ||
        tx.action?.request.simulation.guards.some(
          (guard) => guard.status === "failed",
        )));
  const terminal = Boolean(
    tx.commit
      ? ["confirmed", "rejected", "failed", "expired"].includes(tx.commit.state)
      : tx.action && tx.action.state !== "pending",
  );
  return { step, signed, rejected, failed, terminal };
}

/** Still in play: an unfinished commit or pending action, or work staged in
 * the current turn. Everything else is History. */
export function isToSign(tx: ActivityTransaction, current: boolean): boolean {
  const live = current || tx.commit != null || tx.action?.state === "pending";
  return live && !transactionProgress(tx).terminal;
}

export function TransactionCard({
  transaction: tx,
  reviewing = false,
  executing,
  current,
  onChain,
  row = false,
}: {
  transaction: ActivityTransaction;
  /** A row inside the To sign card: the card owns the border. */
  row?: boolean;
  /** The chain's receipt verdict while Commit Service has not settled. */
  onChain?: Pick<CommitPresentation, "label" | "onChain">;
  reviewing?: boolean;
  executing: boolean;
  /** Staged in the current turn, including its callback turns. */
  current: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const label = friendlyTransactionLabel(tx.label, tx.kind);
  const { title } = transactionTitle(label);
  const Icon =
    tx.kind === "message"
      ? PenLine
      : tx.kind === "signature"
        ? FileSignature
        : (transactionSemantic(label, tx.kind).Icon ?? Layers3);
  const Chain = useMemo(
    () =>
      tx.family === "svm"
        ? SolanaIcon
        : tx.chainId
          ? (getChainIcon(tx.chainId) ?? Circle)
          : Circle,
    [tx.family, tx.chainId],
  );
  // Shown only when known: an EVM signature that names no chain has none.
  const network =
    tx.family === "svm"
      ? solanaNetworkName(tx.cluster)
      : tx.chainId
        ? (getChainInfo(tx.chainId)?.name ?? `Chain ${tx.chainId}`)
        : undefined;
  const { step, signed, rejected, failed, terminal } = transactionProgress(tx);
  // An unfinished commit or pending action stays live across turns; staged
  // work that never reached either is live only while its turn is current.
  const active = current || tx.commit != null || tx.action?.state === "pending";
  const animating =
    (active || executing) && !signed && !rejected && !failed && !terminal;
  const animatedStep = executing ? 3 : step;
  const pendingStyle = active && !signed && !rejected && !terminal;
  // A message is checked, not simulated: nothing runs on chain. A `signature`
  // (a sign Action, today a Solana message) goes straight to the wallet: no
  // review or safety check runs, so it has no such phase.
  const phases = [
    "Stage",
    tx.kind === "message" ? "Check" : "Simulate",
    "Commit",
    "Signed",
  ]
    .map((name, index) => ({ name, index }))
    .filter(({ index }) => tx.kind !== "signature" || index !== 1);
  return (
    <m.div
      layout="position"
      // A row folds open and shut inside the To sign card, so the card's
      // height follows instead of jumping when a batch leaves.
      initial={
        reduceMotion
          ? false
          : row
            ? { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }
            : { opacity: 0, y: 8 }
      }
      animate={
        row
          ? { opacity: 1, height: 84, paddingTop: 12, paddingBottom: 12 }
          : { opacity: 1, y: 0 }
      }
      exit={
        reduceMotion
          ? undefined
          : row
            ? { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }
            : { opacity: 0, y: -4 }
      }
      transition={{
        duration: reduceMotion ? 0 : row ? 0.3 : 0.24,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        "group/tx flex flex-col justify-center px-3 transition-colors duration-200 motion-reduce:transition-none",
        row
          ? "overflow-hidden bg-transparent"
          : cn(
              "bg-aomi-surface rounded-card h-[84px] border py-3",
              pendingStyle
                ? reviewing
                  ? "border-aomi-accent/50 border-dashed"
                  : "border-aomi-muted/40 border-dashed"
                : "border-aomi-border",
            ),
      )}
      data-pending={pendingStyle || undefined}
      aria-description={
        reviewing && pendingStyle
          ? "Included in the current wallet request"
          : undefined
      }
      data-testid="activity-transaction"
    >
      <div>
        <div className="flex items-center gap-2">
          <Icon className="text-aomi-muted size-4 shrink-0" />
          <span
            className="type-control min-w-0 flex-1 truncate font-medium"
            title={label}
          >
            {title}
          </span>
          {network && (
            <StatusPill className="max-w-[128px] font-normal">
              {createElement(Chain, { className: "size-3 shrink-0" })}
              <span className="truncate" title={network}>
                {network}
              </span>
            </StatusPill>
          )}
        </div>
        <div
          className={cn(
            "mt-2.5 grid gap-1.5",
            phases.length === 3 ? "grid-cols-3" : "grid-cols-4",
          )}
          aria-label={`Transaction preparation: ${tx.stage}; signing: ${rejected ? "rejected" : signed ? "signed" : "not signed"}`}
        >
          {phases.map(({ name, index }) => (
            <div
              key={name}
              title={
                index === 3
                  ? onChain
                    ? onChain.label
                    : rejected
                      ? "Signing rejected"
                      : signed
                        ? "Signed"
                        : "Not yet signed"
                  : name
              }
            >
              <div
                data-active-phase={
                  (animating && index === animatedStep) || undefined
                }
                style={
                  animating && index === animatedStep
                    ? {
                        backgroundImage:
                          "linear-gradient(90deg, var(--aomi-accent-subtle), var(--aomi-accent), var(--aomi-accent-subtle))",
                        backgroundSize: "200% 100%",
                      }
                    : undefined
                }
                // A CSS loop, not a motion one: it starts the moment the row
                // mounts, even inside a presence that skips first-render
                // animations (that froze a freshly staged row).
                className={cn(
                  animating &&
                    index === animatedStep &&
                    "animate-phase-sweep motion-reduce:animate-none",
                  "h-[3px] rounded-full transition-colors motion-reduce:transition-none",
                  (index === 1 && failed) ||
                    (index === 3 &&
                      (rejected || onChain?.onChain === "reverted"))
                    ? "bg-aomi-danger"
                    : index <= step || (index === 3 && signed)
                      ? "bg-aomi-accent"
                      : "bg-aomi-border",
                )}
              />
              <span
                className={cn(
                  "mt-1.5 block truncate text-[10px] leading-3 transition-colors",
                  animating && index === animatedStep
                    ? "text-aomi-fg font-medium"
                    : index <= step || (index === 3 && signed)
                      ? "text-aomi-muted"
                      : "text-aomi-muted/60",
                )}
              >
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </m.div>
  );
}

/**
 * A finished (or never sent) transaction in History: one line with its chain
 * mark and a status word. A sent one links to the explorer.
 */
export function HistoryRow({
  transaction: tx,
  onChain,
}: {
  transaction: ActivityTransaction;
  onChain?: Pick<CommitPresentation, "label" | "onChain">;
}) {
  const label = friendlyTransactionLabel(tx.label, tx.kind);
  const { title } = transactionTitle(label);
  const Icon =
    tx.kind === "message"
      ? PenLine
      : tx.kind === "signature"
        ? FileSignature
        : (transactionSemantic(label, tx.kind).Icon ?? Layers3);
  const Chain =
    tx.family === "svm"
      ? SolanaIcon
      : tx.chainId
        ? (getChainIcon(tx.chainId) ?? Circle)
        : undefined;
  const network =
    tx.family === "svm"
      ? solanaNetworkName(tx.cluster)
      : tx.chainId
        ? (getChainInfo(tx.chainId)?.name ?? `Chain ${tx.chainId}`)
        : undefined;
  const { signed, rejected, failed } = transactionProgress(tx);
  const confirmed =
    tx.commit?.state === "confirmed" || onChain?.onChain === "success";
  const status = rejected
    ? { word: "Rejected", tone: "muted" as const }
    : failed || onChain?.onChain === "reverted"
      ? { word: "Failed", tone: "danger" as const }
      : confirmed
        ? { word: "Confirmed", tone: "done" as const }
        : signed
          ? { word: "Sent", tone: "done" as const }
          : { word: "Not sent", tone: "muted" as const };
  const hash = tx.commit
    ? projectCommitLifecycle(tx.commit).transactionId
    : undefined;
  const chain =
    tx.family === "svm" ? normalizeSolanaCluster(tx.cluster) : tx.chainId;
  const href =
    status.tone === "done" && hash && chain != null
      ? explorerUrl(chain, "tx", hash)
      : null;
  const word = (
    <span
      className={cn(
        "type-meta inline-flex items-center gap-1 whitespace-nowrap transition-colors motion-reduce:transition-none",
        status.tone === "danger" ? "text-aomi-danger" : "text-aomi-muted",
        href && "group-hover/row:text-aomi-fg",
      )}
    >
      {status.word}
      {href ? (
        <ArrowUpRight
          className="size-3 transition-transform group-hover/row:-translate-y-px group-hover/row:translate-x-px motion-reduce:transition-none"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
  const body = (
    <>
      <Icon className="text-aomi-muted size-4 shrink-0" />
      <span
        className="type-control min-w-0 flex-1 truncate font-medium"
        title={label}
      >
        {title}
      </span>
      {/* Chain and status read as one unit at the end of the line. */}
      <span className="flex shrink-0 items-center gap-1.5">
        {Chain && network
          ? createElement(Chain, {
              className: "size-3 shrink-0",
              "aria-label": network,
              role: "img",
            })
          : null}
        {word}
      </span>
    </>
  );
  const rowClass = "group/row rounded-control flex min-h-9 items-center gap-2";
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${title}, ${status.word}. Open in the explorer`}
      className={cn(focusRing, rowClass)}
      data-testid="activity-history-row"
    >
      {body}
    </a>
  ) : (
    <div className={rowClass} data-testid="activity-history-row">
      {body}
    </div>
  );
}
