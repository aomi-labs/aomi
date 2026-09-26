"use client";

import { useEffect, useRef, useState } from "react";
import { useOptionalAomiRuntime } from "@aomi-labs/react";
import type {
  AomiAccountProfile,
  TransactionSafetyMode,
  TransactionSafetyPolicy,
} from "@aomi-labs/client";
import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../../ui/dialog";
import { useShellTransport } from "../../transport";
import {
  fetchTransactionSafety,
  saveTransactionSafety,
} from "./transaction-safety-api";

export const SAFETY_MODES = [
  {
    value: "guarded_only",
    label: "Guarded only",
    description:
      "Only allow supported actions covered by protocol guards. Block generic actions and critical findings.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description:
      "Allow supported and generic actions. Block critical guard findings; show limited-coverage warnings.",
  },
  {
    value: "unrestricted",
    label: "Danger mode",
    description:
      "Allow actions even when guards flag a critical issue or cannot assess them. Wallet permissions and limits still apply.",
  },
] as const;

export function TransactionSafetySettings() {
  const runtime = useOptionalAomiRuntime();
  const threadId = runtime?.currentThreadId;
  const { json: request } = useShellTransport();
  const [thread, setThread] = useState<TransactionSafetyPolicy>();
  const [account, setAccount] = useState<TransactionSafetyPolicy>();
  const [selected, setSelected] = useState<TransactionSafetyMode>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const generation = useRef(0);
  const saveButton = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = ++generation.current;
    setBusy(false);
    setThread(undefined);
    setAccount(undefined);
    setSelected(undefined);
    setError(undefined);
    setNotice(undefined);
    setConfirm(false);
    void fetchTransactionSafety(request)
      .then((policy) => {
        if (current !== generation.current) return;
        setAccount(policy);
        if (!threadId) setSelected(policy.mode);
      })
      .catch((cause: unknown) => {
        if (current === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your default safety policy.",
          );
      });
    if (threadId)
      void fetchTransactionSafety(request, threadId)
        .then((policy) => {
          if (current !== generation.current) return;
          setThread(policy);
          setSelected(policy.mode);
        })
        .catch((cause: unknown) => {
          if (current === generation.current)
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not load this chat's safety policy.",
            );
        });
    void request<AomiAccountProfile>("/api/account")
      .then((profile) => {
        if (current === generation.current)
          setAutomatic(
            profile.signing_policies.some((policy) => policy.mode === "auto"),
          );
      })
      .catch(() => {
        if (current === generation.current) setAutomatic(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [request, threadId]);

  async function save(asDefault: boolean) {
    const prior = asDefault ? account : thread;
    if (
      !prior ||
      !selected ||
      busy ||
      (asDefault && selected === "unrestricted")
    )
      return;
    const current = generation.current;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setConfirm(false);
    try {
      const policy = await saveTransactionSafety(
        request,
        selected,
        prior.revision,
        asDefault ? undefined : threadId,
      );
      if (current !== generation.current) return;
      if (asDefault) setAccount(policy);
      else {
        setThread(policy);
        setSelected(policy.mode);
      }
      setNotice(
        asDefault
          ? "Default saved. Existing chats keep their current selection."
          : "Safety policy saved for this chat. Future actions use this selection.",
      );
    } catch (cause) {
      if (current !== generation.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save transaction safety. Refresh and try again.",
      );
      // Read the latest revision after a conflict; never silently retry a write.
      try {
        const latest = await fetchTransactionSafety(
          request,
          asDefault ? undefined : threadId,
        );
        if (current === generation.current) {
          if (asDefault) setAccount(latest);
          else setThread(latest);
        }
      } catch {
        /* Preserve the original error and keep admission server-owned. */
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const canSave = Boolean(
    thread && selected && selected !== thread.mode && !busy,
  );
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby="transaction-safety-heading"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="transaction-safety-heading" className="text-sm font-medium">
          Transaction safety
        </h2>
        <span className="text-aomi-muted text-xs">
          {threadId ? "Applies to this chat" : "Default for new chats"}
        </span>
      </div>
      <p className="text-aomi-muted text-xs">
        Choose which actions Aomi may execute.
      </p>
      <fieldset disabled={busy || selected === undefined} className="space-y-2">
        <legend className="sr-only">Transaction safety mode</legend>
        {SAFETY_MODES.map((mode) => (
          <label
            key={mode.value}
            className="border-aomi-border hover:bg-aomi-hover flex cursor-pointer items-start gap-3 rounded-xl border p-3"
          >
            <input
              type="radio"
              name="transaction-safety"
              value={mode.value}
              checked={selected === mode.value}
              disabled={mode.value === "unrestricted" && !threadId}
              onChange={() => setSelected(mode.value)}
              className="mt-0.5"
            />
            <span>
              <span className="text-sm font-medium">
                {mode.label}
                {mode.value === "balanced" && (
                  <span className="text-aomi-muted ml-2 text-xs">Default</span>
                )}
              </span>
              <span className="text-aomi-muted mt-1 block text-xs">
                {mode.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {selected === undefined && !error && (
        <p role="status" className="text-aomi-muted text-xs">
          Loading transaction safety…
        </p>
      )}
      {error && (
        <p role="alert" className="text-aomi-danger break-words text-xs">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-aomi-muted text-xs">
          {notice}
        </p>
      )}
      {selected === "unrestricted" && (
        <p className="text-aomi-danger text-xs">
          Danger mode applies only to this chat and cannot be the account
          default.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {threadId && (
          <Button
            ref={saveButton}
            disabled={!canSave}
            onClick={() =>
              selected === "unrestricted" ? setConfirm(true) : void save(false)
            }
          >
            {busy ? "Saving…" : "Save for this chat"}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={
            busy ||
            !account ||
            !selected ||
            selected === "unrestricted" ||
            selected === account.mode
          }
          onClick={() => void save(true)}
        >
          Set default for new chats
        </Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (saveButton.current && !saveButton.current.disabled)
              saveButton.current.focus();
            else section.current?.focus();
          }}
        >
          <DialogTitle>Enable Danger mode for this chat?</DialogTitle>
          <DialogDescription>
            Aomi may proceed even when guards flag critical issues or cannot
            assess an action. Existing wallet approvals and limits remain in
            place.
            {automatic &&
              " Eligible actions may execute automatically under your existing grant."}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void save(false)}>
              Enable Danger mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
