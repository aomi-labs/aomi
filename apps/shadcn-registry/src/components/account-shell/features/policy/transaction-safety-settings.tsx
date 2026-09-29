"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, Loader2 } from "lucide-react";
import type {
  TransactionSafetyMode,
  TransactionSafetyPolicy,
} from "@aomi-labs/client";
import { cn } from "@aomi-labs/react";
import { listGroupClass } from "../../../ui/aomi/list-group";
import { SectionHeader } from "../../../ui/aomi/section-header";
import { useShellTransport } from "../../transport";
import {
  fetchTransactionSafety,
  saveTransactionSafety,
} from "./transaction-safety-api";
import {
  TRANSACTION_SAFETY_LEVELS,
  transactionSafetyLevel,
} from "./transaction-safety-levels";

/** The note under each policy; the levels file keeps the short menu copy. */
const LEVEL_DETAIL: Record<TransactionSafetyMode, string> = {
  guarded_only:
    "Only actions a protocol guard covers. Generic actions and any critical finding are blocked.",
  balanced:
    "Supported and generic actions. Stops on critical findings and warns when a guard has limited coverage.",
  unrestricted:
    "Runs actions even when a guard flags a critical issue or can't check them. Only inside a chat, from the shield next to the model.",
};

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * The account default every new chat starts on. It saves on change against the
 * loaded revision; a chat's own level is set from the composer, not here.
 */
export function TransactionSafetySettings() {
  const { json: request } = useShellTransport();
  const [policy, setPolicy] = useState<TransactionSafetyPolicy>();
  const [draft, setDraft] = useState<TransactionSafetyMode>();
  const [error, setError] = useState<string>();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setPolicy(undefined);
    setError(undefined);
    void fetchTransactionSafety(request)
      .then((next) => {
        if (alive.current) setPolicy(next);
      })
      .catch((cause: unknown) => {
        if (alive.current)
          setError(message(cause, "Could not load your guard policy."));
      });
    return () => {
      alive.current = false;
    };
  }, [request]);

  const choose = async (mode: TransactionSafetyMode) => {
    if (
      !policy ||
      draft !== undefined ||
      mode === policy.mode ||
      !transactionSafetyLevel(mode).canBeDefault
    )
      return;
    setDraft(mode);
    setError(undefined);
    try {
      const next = await saveTransactionSafety(request, mode, policy.revision);
      if (!alive.current) return;
      setPolicy(next);
    } catch (cause) {
      if (!alive.current) return;
      setError(message(cause, "Could not save your default. Try again."));
      // Read the latest revision after a conflict; never silently retry a write.
      try {
        const latest = await fetchTransactionSafety(request);
        if (alive.current) setPolicy(latest);
      } catch {
        /* Keep the original error; admission stays server-owned. */
      }
    } finally {
      if (alive.current) setDraft(undefined);
    }
  };

  const shown = draft ?? policy?.mode;
  const choices = TRANSACTION_SAFETY_LEVELS.filter(
    (level) => level.canBeDefault,
  );

  // Radio-group keys: arrows move between the policies a default can use.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step || !shown) return;
    event.preventDefault();
    const index = choices.findIndex((level) => level.id === shown);
    const next = choices[(index + step + choices.length) % choices.length]!;
    void choose(next.id);
    event.currentTarget
      .querySelector<HTMLElement>(`[data-policy="${next.id}"]`)
      ?.focus();
  };

  return (
    <section
      aria-labelledby="guard-policy-heading"
      className="flex flex-col gap-2"
    >
      <SectionHeader
        id="guard-policy-heading"
        title="Guard policy"
        detail="Default for new chats"
        help="Each new chat starts on this policy. Change a single chat from the shield next to the model; chats you already have keep theirs."
      />
      {shown ? (
        <div
          role="radiogroup"
          aria-labelledby="guard-policy-heading"
          aria-busy={draft !== undefined || undefined}
          onKeyDown={onKeyDown}
          className={cn(listGroupClass, "flex flex-col gap-0.5 p-1.5")}
        >
          {TRANSACTION_SAFETY_LEVELS.map((level) => {
            const selected = level.id === shown;
            const disabled = !level.canBeDefault || draft !== undefined;
            return (
              <button
                key={level.id}
                type="button"
                role="radio"
                data-policy={level.id}
                aria-checked={selected}
                aria-labelledby={`guard-policy-${level.id}`}
                aria-describedby={`guard-policy-${level.id}-note`}
                aria-disabled={!level.canBeDefault || undefined}
                disabled={disabled}
                tabIndex={selected ? 0 : -1}
                onClick={() => void choose(level.id)}
                className={cn(
                  "rounded-control flex w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors",
                  "focus-visible:ring-aomi-ring/50 focus-visible:ring-2",
                  // Like the composer menu: the check marks the choice; fill is only
                  // hover/focus, so a hovered row never looks selected.
                  "hover:bg-aomi-surface-2 focus-visible:bg-aomi-surface-2 disabled:hover:bg-transparent",
                  !level.canBeDefault &&
                    "cursor-default opacity-50 hover:bg-transparent",
                )}
              >
                <level.Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    level.danger ? "text-aomi-danger" : "text-aomi-muted",
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    id={`guard-policy-${level.id}`}
                    className={cn(
                      "type-row",
                      level.danger && "text-aomi-danger",
                    )}
                  >
                    {level.label}
                  </span>
                  <span
                    id={`guard-policy-${level.id}-note`}
                    className="type-meta text-aomi-muted"
                  >
                    {LEVEL_DETAIL[level.id]}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="flex w-5 shrink-0 items-center justify-center self-center"
                >
                  {selected && draft !== undefined ? (
                    <Loader2 className="text-aomi-muted size-4 animate-spin" />
                  ) : selected ? (
                    <CheckIcon className="text-aomi-accent size-4" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : !error ? (
        <p role="status" className="type-meta text-aomi-muted">
          Loading your guard policy…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="type-meta text-aomi-danger break-words">
          {error}
        </p>
      ) : null}
    </section>
  );
}
