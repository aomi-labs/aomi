"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

import { AomiButton } from "./button";
import { DialogFrame } from "./confirm-dialog";
import type { RenameOptions } from "./rename-dialog";

/** The Rename dialog itself; `useRenameDialog` loads it on first open. */
export function RenameDialogBody({
  options,
  onClose,
}: {
  options: RenameOptions;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(options.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const unchanged = trimmed === options.value.trim();
  const canSave =
    !busy && !unchanged && (Boolean(trimmed) || Boolean(options.allowEmpty));

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      if ((await options.onSave(trimmed)) !== false) return onClose();
    } catch {
      // A throw reads like `false`: stay open with the error.
    }
    setError("Couldn’t save that. Try again.");
    setBusy(false);
  };

  return (
    <DialogFrame
      role="dialog"
      open
      busy={busy}
      onOpenChange={(open) => !open && onClose()}
      title={options.title}
      description={options.description}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const input = (
          event.currentTarget as HTMLElement | null
        )?.querySelector("input");
        input?.focus();
        input?.select();
      }}
      footer={
        <>
          <Dialog.Close asChild>
            <AomiButton variant="ghost" disabled={busy}>
              Cancel
            </AomiButton>
          </Dialog.Close>
          <AomiButton
            variant="primary"
            disabled={!canSave}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            Save
          </AomiButton>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label
          htmlFor="aomi-rename-input"
          className="type-meta text-aomi-fg font-medium"
        >
          Name
        </label>
        <div className="border-aomi-border bg-aomi-bg focus-within:border-aomi-accent focus-within:ring-aomi-accent/15 rounded-control flex h-10 items-center gap-2 border px-3 transition-[border-color,box-shadow] focus-within:ring-[3px]">
          <input
            id="aomi-rename-input"
            value={draft}
            maxLength={options.maxLength ?? 60}
            placeholder={options.placeholder}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            className="type-control text-aomi-fg placeholder:text-aomi-muted min-w-0 flex-1 bg-transparent outline-none"
          />
          <span className="type-meta text-aomi-muted shrink-0 tabular-nums">
            {draft.length}/{options.maxLength ?? 60}
          </span>
        </div>
        {error ? (
          <p role="alert" className="type-meta text-aomi-danger">
            {error}
          </p>
        ) : null}
      </form>
    </DialogFrame>
  );
}
