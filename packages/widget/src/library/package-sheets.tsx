"use client";
import type { AomiPackage } from "@aomi-labs/client";
import { useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, Lock } from "lucide-react";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { AomiButton } from "@/ui/aomi/button";
import { SheetAlert, SheetHeader } from "@/wallet/picker/sheet-parts";
import { PackageTile } from "@/icons/package-mark";
import { packageIconUrl } from "@/icons/preview-package-icons";
import { personSlots } from "./model";

const INPUT =
  "border-aomi-border bg-aomi-raised placeholder:text-aomi-muted rounded-control h-10 w-full border px-3.5 text-base outline-none focus:border-aomi-muted md:text-[14px]";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-meta font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="type-meta text-aomi-muted">{hint}</span> : null}
    </div>
  );
}

/** Header, body and the equal-width Cancel and submit buttons. */
function SheetForm({
  title,
  description,
  leading,
  submit,
  canSubmit,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  leading: ReactNode;
  submit: string;
  canSubmit: boolean;
  error: string | null;
  onSubmit: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    await onSubmit();
    setBusy(false);
  };
  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        title={title}
        description={description}
        leading={leading}
        onClose={onClose}
      />
      <form onSubmit={(event) => void send(event)}>
        <div className="flex flex-col gap-3.5 px-5 pb-1 pt-2">
          {children}
          {error ? <SheetAlert>{error}</SheetAlert> : null}
        </div>
        <div className="flex gap-2 px-5 pb-5 pt-4">
          <AomiButton className="h-10 flex-1" onClick={onClose}>
            Cancel
          </AomiButton>
          <AomiButton
            type="submit"
            variant="primary"
            className="h-10 flex-1"
            disabled={!canSubmit || busy}
          >
            {submit}
          </AomiButton>
        </div>
      </form>
    </AomiSheet>
  );
}

/**
 * "Add with code": a private package's activation code. The code lives in
 * this field and the one request; never in storage or a log.
 */
export function AddWithCodeSheet({
  onActivate,
  onClose,
}: {
  /** Resolves to a message to show in place, or null on success. */
  onActivate: (code: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <SheetForm
      title="Add a private package"
      leading={
        <span className="border-aomi-overlay-border bg-aomi-surface-2 text-aomi-accent rounded-control flex size-9 shrink-0 items-center justify-center border">
          <KeyRound aria-hidden className="size-5" />
        </span>
      }
      submit="Add"
      canSubmit={code.trim() !== ""}
      error={error}
      onSubmit={async () => setError(await onActivate(code.trim()))}
      onClose={onClose}
    >
      <Field
        id="package-code"
        label="Activation code"
        hint="Codes come from the package’s builder."
      >
        <input
          id="package-code"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          className={`${INPUT} font-mono`}
        />
      </Field>
    </SheetForm>
  );
}

/**
 * The person's own keys for a package: one hidden field per person slot.
 * Saved values are never shown again; an empty field keeps its saved value.
 */
export function ConnectSheet({
  row,
  onSave,
  onClose,
}: {
  row: AomiPackage;
  /** Saves the filled slots; false when the backend refused. */
  onSave: (values: [slot: string, value: string][]) => Promise<boolean>;
  onClose: () => void;
}) {
  const slots = personSlots(row);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const filled = slots
    .map((slot): [string, string] => [
      slot.name,
      (drafts[slot.name] ?? "").trim(),
    ])
    .filter(([, value]) => value);
  const complete = slots.every(
    (slot) =>
      !slot.required || slot.status === "ready" || drafts[slot.name]?.trim(),
  );
  const replacing = slots.some((slot) => slot.status === "ready");
  return (
    <SheetForm
      title={`Connect ${row.display_name}`}
      description="Add your key once. It works in every chat."
      leading={<PackageTile iconUrl={packageIconUrl(row)} />}
      submit={replacing ? "Save" : "Connect"}
      canSubmit={complete && filled.length > 0}
      error={error}
      onSubmit={async () => {
        if (await onSave(filled)) onClose();
        else setError("Couldn’t save the key. Please try again.");
      }}
      onClose={onClose}
    >
      {slots.map((slot) => {
        const id = `package-key-${row.package_id}-${slot.name}`;
        return (
          <Field
            key={slot.name}
            id={id}
            label={slot.required ? slot.name : `${slot.name} · optional`}
            hint={slot.description || undefined}
          >
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              placeholder={
                slot.status === "ready"
                  ? "Saved · paste a new key"
                  : "Paste your key"
              }
              value={drafts[slot.name] ?? ""}
              onChange={(event) => {
                setDrafts((current) => ({
                  ...current,
                  [slot.name]: event.target.value,
                }));
                setError(null);
              }}
              className={INPUT}
            />
          </Field>
        );
      })}
      <div className="rounded-control bg-aomi-surface-2 type-meta text-aomi-fg/80 flex items-start gap-2.5 px-3 py-2.5">
        <Lock aria-hidden className="text-aomi-muted mt-px size-3.5 shrink-0" />
        <span>
          Stored encrypted in your Aomi account. The package’s code only
          receives it during a call.
        </span>
      </div>
    </SheetForm>
  );
}
