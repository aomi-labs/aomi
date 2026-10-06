"use client";

import { useCallback, useState } from "react";

import type { SecretSlot } from "@aomi-labs/deploy";

// A native button rather than widget-lib's: this panel mounts in four places,
// two of which are tested without a PostCSS pipeline, and pulling the styled
// component in drags a stylesheet import through every one of them. The
// styling here is the same handful of utility classes either way.
const buttonClass =
  "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 " +
  "inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-opacity";

export type MissingSecretSlot = {
  app: string;
  slot: SecretSlot;
  applicationId?: number;
};

type RequiredSecretsPanelProps = {
  /** Exactly the slots that are missing, already filtered by the caller. */
  slots: MissingSecretSlot[];
  /**
   * Why the values could not be verified, if that is what is blocking. The
   * panel still renders whatever slots it was given underneath this — a check
   * that failed is not a reason to take the inputs away.
   */
  verificationError?: string | null;
  /**
   * Whether retrying the verification could help. False for an operator-side
   * misconfiguration — offering Retry there implies the builder can fix it.
   */
  verificationRetryable?: boolean;
  /**
   * How many values are missing. Defaults to the number of slots rendered, but
   * the two differ whenever a slot NAME is known and its manifest descriptor
   * is not — the count must report what is actually missing, not how many rows
   * happen to be renderable.
   */
  missingCount?: number;
  /** Present only while the check has not answered yet. */
  pending?: boolean;
  onRetryVerification?: () => Promise<unknown> | void;
  /** Writes the values. Resolve to continue, throw to surface an error. */
  onSave: (valuesByApplication: Map<number, Record<string, string>>) => Promise<void>;
  /** What the caller was doing when the gate closed, e.g. "Activate". */
  actionLabel?: string;
};

/**
 * The in-place editor for required Environment values a deploy is missing.
 *
 * Lives here rather than inside `DeployStep` because the gate closes in three
 * other places — the dashboard's Activate row, the promote dialog, and the
 * Environment tab — and each of those previously did nothing but disable a
 * button and point at another tab.
 *
 * Two rules this component exists to enforce:
 *
 *  1. A failed verification renders as a banner ABOVE the inputs, never
 *     instead of them. The reported symptom of issue #990 was a builder being
 *     told values were missing with no way to enter them, which is what an
 *     early return on the error produced.
 *  2. Slots whose owning application id is unknown are shown disabled with the
 *     reason, rather than silently dropped — a row that cannot be saved is
 *     still information the builder needs.
 */
export function RequiredSecretsPanel({
  slots,
  verificationError,
  verificationRetryable = true,
  missingCount,
  pending,
  onRetryVerification,
  onSave,
  actionLabel,
}: RequiredSecretsPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = missingCount ?? slots.length;
  const keyFor = (entry: MissingSecretSlot) => `${entry.app}::${entry.slot.name}`;
  const saveable = slots.filter((entry) => entry.applicationId !== undefined);

  const save = useCallback(async () => {
    const valuesByApplication = new Map<number, Record<string, string>>();
    for (const entry of saveable) {
      const value = values[keyFor(entry)] ?? "";
      if (!value) {
        setError(`Enter a value for ${entry.slot.name}.`);
        return;
      }
      const current = valuesByApplication.get(entry.applicationId!) ?? {};
      current[entry.slot.name] = value;
      valuesByApplication.set(entry.applicationId!, current);
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(valuesByApplication);
      setValues({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [onSave, saveable, values]);

  const retry = useCallback(async () => {
    if (!onRetryVerification) return;
    setRetrying(true);
    setError(null);
    try {
      await onRetryVerification();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }, [onRetryVerification]);

  const heading = pending
    ? "Checking required secrets…"
    : verificationError
      ? "Required secrets could not be verified."
      : [
          `${count} required secret${count === 1 ? "" : "s"} missing.`,
          actionLabel ? `${actionLabel} is blocked until they are set.` : "",
        ]
          .filter(Boolean)
          .join(" ");

  return (
    <div
      className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
      role="alert"
    >
      <div className="font-medium text-amber-800">{heading}</div>

      {verificationError && (
        <div className="flex flex-wrap items-center gap-3 text-amber-800">
          <span>{verificationError}</span>
          {onRetryVerification && verificationRetryable && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={retrying}
              className={buttonClass}
            >
              {retrying ? "Retrying…" : "Retry required secrets"}
            </button>
          )}
        </div>
      )}

      {slots.map((entry) => {
        const key = keyFor(entry);
        const unsaveable = entry.applicationId === undefined;
        return (
          <label key={key} className="block">
            <span className="mb-1 block font-mono text-[11px] text-amber-900">
              {entry.app} · {entry.slot.name}
            </span>
            <input
              type="password"
              value={values[key] ?? ""}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: event.target.value,
                }))
              }
              placeholder={
                unsaveable
                  ? "Application identity unavailable — reload the project"
                  : entry.slot.description || "Required value"
              }
              aria-label={`${entry.app} ${entry.slot.name}`}
              disabled={saving || unsaveable}
              className="bg-input text-foreground border-border h-8 w-full rounded-md border px-2 text-xs disabled:opacity-60"
            />
          </label>
        );
      })}

      {error && <div className="text-destructive">{error}</div>}

      {saveable.length > 0 && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || pending}
          className={buttonClass}
        >
          {saving ? "Saving…" : "Save required secrets"}
        </button>
      )}
    </div>
  );
}
