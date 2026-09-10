"use client";

import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { m, useReducedMotion } from "motion/react";
import { Circle, FileSignature, Layers3 } from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import { getChainIcon } from "../icons/chain-map";
import type { ActivityTransaction } from "./model";
import { friendlyTransactionLabel, transactionSemantic } from "./presentation";

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
    if (el)
      setEdges({
        top: el.scrollTop > 2,
        bottom: el.scrollHeight - el.clientHeight - el.scrollTop > 2,
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
          aria-label="Transactions, newest first"
          className="aui-current-transactions overflow-y-auto overscroll-contain rounded-2xl outline-offset-2 [overflow-anchor:none]"
        >
          <div className="space-y-2.5">{children}</div>
        </m.div>
        <div
          aria-hidden="true"
          data-scroll-fade="top"
          className={cn(
            "from-aomi-raised pointer-events-none absolute inset-x-0 top-0 h-5 rounded-t-2xl bg-gradient-to-b to-transparent transition-opacity motion-reduce:transition-none",
            edges.top ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden="true"
          data-scroll-fade="bottom"
          className={cn(
            "from-aomi-raised pointer-events-none absolute inset-x-0 bottom-0 h-5 rounded-b-2xl bg-gradient-to-t to-transparent transition-opacity motion-reduce:transition-none",
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
          className="text-aomi-muted hover:text-aomi-fg mt-2 flex items-center gap-2 py-1 text-[12px] transition-colors motion-reduce:transition-none"
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
  active,
}: {
  transaction: ActivityTransaction;
  reviewing?: boolean;
  executing: boolean;
  active: boolean;
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
  const result = tx.action?.result;
  const leg =
    result?.status === "submitted"
      ? result.legs.find((leg) => leg.id === `leg_${(tx.actionIndex ?? 0) + 1}`)
      : undefined;
  const signed =
    leg?.status === "submitted" ||
    (result?.status === "signed" && result.outputs.length > 0);
  const rejected =
    leg?.status === "rejected" ||
    result?.status === "rejected" ||
    tx.action?.state === "rejected";
  const failed =
    tx.stage === "simulation-failed" ||
    (tx.action?.request.type !== "sign" &&
      (tx.action?.request.simulation.status === "failed" ||
        tx.action?.request.simulation.guards.some(
          (guard) => guard.status === "failed",
        )));
  const terminal = tx.action && tx.action.state !== "pending";
  const animating =
    (active || executing) && !signed && !rejected && !failed && !terminal;
  const animatedStep = executing ? 3 : step;
  const pendingStyle =
    !signed &&
    !rejected &&
    !terminal &&
    (active || tx.action?.state === "pending");
  return (
    <div
      className={cn(
        "group/tx bg-aomi-surface flex h-[84px] flex-col justify-center rounded-2xl border px-3 py-3 transition-colors duration-200 motion-reduce:transition-none",
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
            className="min-w-0 flex-1 truncate text-[13px] font-medium"
            title={label}
          >
            {label}
          </span>
          <span
            className="bg-aomi-surface-2 text-aomi-muted inline-flex max-w-[100px] items-center gap-1.5 rounded-full px-2 py-1 text-[10px]"
            title={network}
          >
            {createElement(Chain, { className: "size-3 shrink-0" })}
            <span className="truncate">{network}</span>
          </span>
        </div>
        <div
          className="mt-2.5 grid grid-cols-4 gap-1.5"
          aria-label={`Transaction preparation: ${tx.stage}; signing: ${rejected ? "rejected" : signed ? "signed" : "not signed"}`}
        >
          {["Stage", "Simulate", "Commit", "Signed"].map((name, index) => (
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
                    : index === 1 && tx.kind === "signature"
                      ? "bg-aomi-border"
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
    </div>
  );
}
