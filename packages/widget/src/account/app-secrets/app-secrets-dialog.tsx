"use client";

import { useMemo, useState, type FC } from "react";
import {
  KeyRoundIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useControl, cn } from "@aomi-labs/react";
import type { AomiAppDescriptor, ApplicationId } from "@aomi-labs/client";
import { useAppSecretsState } from "../app-secrets/use-app-secrets-state";
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
 * The app the current thread runs, as the catalog describes it. A stable
 * `applicationId` is required. Stored slots remain addressable even
 * after a newer manifest stops declaring them, so users can remove obsolete
 * credentials.
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

/**
 * Per-user API keys for the selected app.
 *
 * Shown when the selected app declares slots or still has obsolete stored
 * slots. The button's dot summarises state at a glance (green: every required
 * slot is covered, amber: something required is still missing); the dialog lists each slot
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
  const declared = useMemo(
    () => (descriptor?.secrets ?? []).filter((slot) => slot.user_own),
    [descriptor?.secrets],
  );
  const active = Boolean(descriptor) && applicationId != null;
  const operations = useMemo(
    () => ({
      list: listAppSecrets,
      save: saveAppSecrets,
      remove: deleteAppSecret,
    }),
    [deleteAppSecret, listAppSecrets, saveAppSecrets],
  );
  const secretState = useAppSecretsState({
    scopeKey: `${app}:${String(applicationId ?? "")}`,
    applicationId,
    enabled: active,
    declaredSlots: declared,
    operations,
  });

  const [open, setOpen] = useState(false);
  const [showValues, setShowValues] = useState(false);

  const { status, slots, drafts, busy, error } = secretState;
  if (!active || (!secretState.loading && slots.length === 0)) return null;
  const declaredNames = new Set(declared.map((slot) => slot.name));
  const missing = slots
    .filter((slot) => slot.required && !slot.configured)
    .map((slot) => slot.name);
  const configuredCount = slots.filter((slot) => slot.configured).length;
  const dot = status === null ? null : missing.length === 0 ? "ok" : "missing";

  const label = descriptor?.label ?? app;
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    secretState.clearDrafts();
    setShowValues(false);
    if (nextOpen) {
      void secretState.refresh();
    } else {
      secretState.setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            Your own credentials for {label}. They are stored encrypted for your
            account and used only on your threads. Values are never shown again
            after saving.
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
            const obsolete = !declaredNames.has(slot.name);
            const state = obsolete
              ? "No longer used"
              : slot.configured
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
                  {!obsolete ? (
                    <Input
                      id={inputId}
                      type={showValues ? "text" : "password"}
                      autoComplete="off"
                      placeholder={
                        slot.configured
                          ? "Enter a new value to replace"
                          : "Value"
                      }
                      value={drafts[slot.name] ?? ""}
                      onChange={(event) =>
                        secretState.setDraft(slot.name, event.target.value)
                      }
                      disabled={busy}
                    />
                  ) : (
                    <p className="text-muted-foreground flex-1 text-xs">
                      This saved credential can only be removed.
                    </p>
                  )}
                  {slot.configured && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${slot.name}`}
                      disabled={busy}
                      onClick={() => void secretState.remove(slot.name)}
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
            onClick={() => void secretState.save()}
            disabled={busy || !secretState.hasPending}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
