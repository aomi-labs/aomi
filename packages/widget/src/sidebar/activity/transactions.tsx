"use client";

import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Circle, FileSignature, Layers3 } from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import { getChainIcon } from "../icons/chain-map";
import { StatusPill } from "../ui/aomi/status-pill";
import type { ActivityTransaction } from "./model";
import {
  focusRing,
  friendlyTransactionLabel,
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

export function TransactionCard({
  transaction: tx,
  reviewing = false,
  executing,
  current,
}: {
  transaction: ActivityTransaction;
  reviewing?: boolean;
  executing: boolean;
  /** Staged in the current turn, including its callback turns. */
  current: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const label = friendlyTransactionLabel(tx.label, tx.kind);
  const Icon =
    tx.kind === "signature"
      ? FileSignature
      : (transactionSemantic(label, tx.kind).Icon ?? Layers3);
  const Chain = useMemo(
    () => (tx.chainId ? (getChainIcon(tx.chainId) ?? Circle) : Circle),
    [tx.chainId],
  );
  const network = tx.chainId
    ? (getChainInfo(tx.chainId)?.name ?? `Chain ${tx.chainId}`)
    : (tx.cluster ?? "Solana");
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
  const terminal = tx.commit
    ? ["confirmed", "rejected", "failed", "expired"].includes(tx.commit.state)
    : tx.action && tx.action.state !== "pending";
  // An unfinished commit or pending action stays live across turns; staged
  // work that never reached either is live only while its turn is current.
  const active = current || tx.commit != null || tx.action?.state === "pending";
  const animating =
    (active || executing) && !signed && !rejected && !failed && !terminal;
  const animatedStep = executing ? 3 : step;
  const pendingStyle = active && !signed && !rejected && !terminal;
  const phases = ["Stage", "Simulate", "Commit", "Signed"]
    .map((name, index) => ({ name, index }))
    .filter(({ index }) => tx.kind !== "signature" || index !== 1);
  return (
    <m.div
      layout="position"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}
      className={cn(
        "group/tx bg-aomi-surface rounded-card flex h-[84px] flex-col justify-center border px-3 py-3 transition-colors duration-200 motion-reduce:transition-none",
        pendingStyle
          ? reviewing
            ? "border-aomi-accent/50 border-dashed"
            : "border-aomi-muted/40 border-dashed"
          : "border-aomi-border",
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
            {label}
          </span>
          <StatusPill className="max-w-[100px] font-normal">
            {createElement(Chain, { className: "size-3 shrink-0" })}
            <span className="truncate" title={network}>
              {network}
            </span>
          </StatusPill>
        </div>
        <div
          className={cn(
            "mt-2.5 grid gap-1.5",
            tx.kind === "signature" ? "grid-cols-3" : "grid-cols-4",
          )}
          aria-label={`Transaction preparation: ${tx.stage}; signing: ${rejected ? "rejected" : signed ? "signed" : "not signed"}`}
        >
          {phases.map(({ name, index }) => (
            <div
              key={name}
              title={
                index === 3
                  ? rejected
                    ? "Signing rejected"
                    : signed
                      ? "Signed"
                      : "Not yet signed"
                  : name
              }
            >
              <m.div
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
                animate={{
                  backgroundPosition:
                    animating && index === animatedStep && !reduceMotion
                      ? ["0% 0%", "-200% 0%"]
                      : "0% 0%",
                }}
                transition={{
                  duration: 1.3,
                  ease: "linear",
                  repeat:
                    animating && index === animatedStep && !reduceMotion
                      ? Infinity
                      : 0,
                }}
                className={cn(
                  "h-[3px] rounded-full transition-colors motion-reduce:transition-none",
                  (index === 1 && failed) || (index === 3 && rejected)
                    ? "bg-aomi-danger"
                    : index <= step || (index === 3 && signed)
                      ? "bg-aomi-accent"
                      : "bg-aomi-border",
                )}
              />
              <span className="text-aomi-muted mt-1.5 block text-[10px] leading-3">
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </m.div>
  );
}
