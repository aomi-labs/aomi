"use client";

import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import {
  KeyRoundIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useControl, cn } from "@aomi-labs/react";
import type {
  AomiAppDescriptor,
  AomiUserAppSecretSlot,
  AomiUserAppSecrets,
  ApplicationId,
} from "@aomi-labs/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type AppSecretsDialogProps = {
  className?: string;
};

/**
 * The app the current thread runs, as the catalog describes it. Only an app
 * that carries a stable `applicationId` AND declares secret slots has
 * anything for the user to supply.
 */
function selectedDescriptor(
  descriptors: AomiAppDescriptor[],
  app: string,
  applicationId: ApplicationId,
): AomiAppDescriptor | null {
  const wanted = String(applicationId ?? "");
  return (
    descriptors.find(
      (descriptor) =>
        descriptor.name === app &&
        String(descriptor.applicationId ?? "") === wanted,
    ) ?? null
  );
}

/** A required slot is satisfied by the user's own value or the app's. */
function missingRequired(slots: AomiUserAppSecretSlot[]): string[] {
  return slots
    .filter((slot) => slot.required && !slot.configured && !slot.app_provided)
    .map((slot) => slot.name);
}

/**
 * Per-user API keys for the selected app.
 *
 * Shown only when the selected app declares secret slots. The button's dot
 * summarises state at a glance (green: every required slot is covered,
 * amber: something required is still missing); the dialog lists each slot
 * with its status and lets the user save or remove their own value. Values
 * are write-only — the backend never returns them.
 */
export const AppSecretsDialog: FC<AppSecretsDialogProps> = ({ className }) => {
  const {
    state,
    getCurrentThreadApp,
    getCurrentThreadApplicationId,
    listAppSecrets,
    saveAppSecrets,
    deleteAppSecret,
  } = useControl();

  const app = getCurrentThreadApp();
  const applicationId = getCurrentThreadApplicationId();
  const descriptor = useMemo(
    () => selectedDescriptor(state.appDescriptors, app, applicationId),
    [state.appDescriptors, app, applicationId],
  );
  const declared = descriptor?.secrets ?? [];
  const active =
    Boolean(descriptor) && declared.length > 0 && applicationId != null;

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AomiUserAppSecrets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (applicationId == null) return;
    try {
      const next = await listAppSecrets(applicationId);
      setStatus(next);
      setError(null);
    } catch (err) {
      // A guest session gets 401 here; the button still renders so the user
      // learns keys exist, and the dialog explains the failure.
      setStatus(null);
      setError(err instanceof Error ? err.message : "Failed to load app keys");
    }
  }, [applicationId, listAppSecrets]);

  // Refetch whenever the selected app changes so the dot is right before
  // the dialog is ever opened.
  useEffect(() => {
    if (!active) {
      setStatus(null);
      setError(null);
      return;
    }
    void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (open) {
      setDrafts({});
      void refresh();
    }
  }, [open, refresh]);

  if (!active) return null;

  // Before the first answer, fall back to the catalog's declaration so the
  // dialog is usable even when the status read fails.
  const slots: AomiUserAppSecretSlot[] =
    status?.slots ??
    declared.map((slot) => ({
      ...slot,
      configured: false,
      app_provided: false,
    }));
  const missing = missingRequired(slots);
  const configuredCount = slots.filter((slot) => slot.configured).length;
  const dot = status === null ? null : missing.length === 0 ? "ok" : "missing";

  const pending = Object.entries(drafts).filter(([, value]) => value.trim());

  const handleSave = async () => {
    if (pending.length === 0 || applicationId == null) return;
    setBusy(true);
    try {
      const next = await saveAppSecrets(
        applicationId,
        Object.fromEntries(
          pending.map(([name, value]) => [name, value.trim()]),
        ),
      );
      setStatus(next);
      setDrafts({});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save app keys");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (name: string) => {
    if (applicationId == null) return;
    setBusy(true);
    try {
      await deleteAppSecret(applicationId, name);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove app key");
    } finally {
      setBusy(false);
    }
  };

  const label = descriptor?.label ?? app;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative rounded-full", className)}
          aria-label={
            dot === "missing" ? `${label} needs API keys` : `${label} API keys`
          }
          data-app-secrets-state={dot ?? "unknown"}
        >
          <KeyRoundIcon
            className={cn(
              "h-4 w-4",
              dot === "ok" && "text-green-500",
              dot === "missing" && "text-amber-500",
            )}
          />
          {dot === "missing" && (
            <span
              aria-hidden
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label} API keys</DialogTitle>
          <DialogDescription>
            Your own keys for {label}. They are stored encrypted for your
            account and used only on your threads; the app trades your account,
            never a shared one. Values are never shown again after saving.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}

        <div className="space-y-4">
          {slots.map((slot) => {
            const inputId = `app-secret-${slot.name}`;
            const state = slot.configured
              ? "Saved"
              : slot.app_provided
                ? "Provided by app"
                : slot.required
                  ? "Required"
                  : "Optional";
            return (
              <div key={slot.name} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={inputId} className="font-mono text-xs">
                    {slot.name}
                  </Label>
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs",
                      slot.configured && "text-green-600",
                      !slot.configured &&
                        slot.required &&
                        !slot.app_provided &&
                        "text-amber-600",
                      !slot.configured &&
                        (!slot.required || slot.app_provided) &&
                        "text-muted-foreground",
                    )}
                    data-slot-state={state}
                  >
                    {slot.configured && <CheckIcon className="h-3 w-3" />}
                    {state}
                  </span>
                </div>
                {slot.description && (
                  <p className="text-muted-foreground text-xs">
                    {slot.description}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    id={inputId}
                    type={showValues ? "text" : "password"}
                    autoComplete="off"
                    placeholder={
                      slot.configured ? "Enter a new value to replace" : "Value"
                    }
                    value={drafts[slot.name] ?? ""}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [slot.name]: event.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  {slot.configured && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${slot.name}`}
                      disabled={busy}
                      onClick={() => void handleRemove(slot.name)}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowValues((v) => !v)}
              aria-label={showValues ? "Hide values" : "Show values"}
            >
              {showValues ? (
                <EyeOffIcon className="h-4 w-4" />
              ) : (
                <EyeIcon className="h-4 w-4" />
              )}
            </Button>
            <span className="text-muted-foreground text-xs">
              {configuredCount} of {slots.length} saved
            </span>
          </div>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || pending.length === 0}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
