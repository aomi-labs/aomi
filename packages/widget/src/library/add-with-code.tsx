"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { AomiButton } from "@/ui/aomi/button";

/**
 * "Add with code": a private package's access code. Signed in only. The code
 * lives in this field and the one request; never in storage or a log.
 */
export function AddWithCode({
  signedIn,
  disabled,
  onActivate,
}: {
  signedIn: boolean;
  disabled: boolean;
  /** Resolves to a message to show in place, or null on success. */
  onActivate: (code: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!signedIn)
    return (
      <p className="type-meta text-aomi-muted mt-3 px-1">
        Sign in to add a private package
      </p>
    );
  if (!open)
    return (
      <AomiButton
        variant="ghost"
        size="sm"
        className="mt-3 self-start"
        onClick={() => setOpen(true)}
      >
        <Plus /> Add with code
      </AomiButton>
    );
  return (
    <form
      className="mt-3 flex flex-col gap-1.5"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = code.trim();
        if (!value || busy) return;
        setBusy(true);
        setError(null);
        const failure = await onActivate(value);
        setBusy(false);
        if (failure) return setError(failure);
        setCode("");
        setOpen(false);
      }}
    >
      <div className="flex items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label="Package access code"
          placeholder="Access code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          className="border-aomi-border bg-aomi-surface placeholder:text-aomi-muted rounded-control h-8 min-w-0 flex-1 border px-3 text-base outline-none md:text-[13px]"
        />
        <AomiButton
          type="submit"
          variant="primary"
          disabled={disabled || busy || !code.trim()}
        >
          Add
        </AomiButton>
        <AomiButton
          variant="ghost"
          onClick={() => {
            setCode("");
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </AomiButton>
      </div>
      {error ? (
        <p role="alert" className="type-meta text-aomi-danger px-1">
          {error}
        </p>
      ) : null}
    </form>
  );
}
