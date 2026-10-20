"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react";
import {
  normalizeAppDescriptor,
  type AomiAppDescriptor,
} from "@aomi-labs/client";
import { useAomiDisplayCache, usePrivateApps } from "@aomi-labs/react";
import { useShellTransport } from "@/account/transport";
import {
  useAccountOverview,
  useAccountOverviewStore,
} from "@/account/account-overview";
import { installApp } from "@/account/shell/packages-api";
import { ConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { AomiButton } from "@/ui/aomi/button";

class PrivateAppError extends Error {}

export type PrivateAppTarget = { app?: string; applicationId?: number };

export function AddPrivateAppDialog({
  open,
  onOpenChange,
  target,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PrivateAppTarget;
  onAdded?: (app: AomiAppDescriptor) => void;
}) {
  const scope = useAomiDisplayCache()?.scope;
  const visit = JSON.stringify([scope?.backendUrl, scope?.account, target]);
  // Reset the draft and hidden credential whenever the dialog closes.
  return open ? (
    <PrivateAppForm
      key={visit}
      onClose={() => onOpenChange(false)}
      target={target}
      onAdded={onAdded}
    />
  ) : null;
}

function PrivateAppForm({
  onClose,
  target,
  onAdded,
}: {
  onClose: () => void;
  target?: PrivateAppTarget;
  onAdded?: (app: AomiAppDescriptor) => void;
}) {
  const inputId = useId();
  const transport = useShellTransport();
  const account = useAccountOverview();
  const { updateAccountApps } = useAccountOverviewStore();
  const privateApps = usePrivateApps();
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<AomiAppDescriptor | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
    };
  }, []);

  async function add() {
    if (busy) return;
    const credential = key.trim();
    if (!credential) {
      setError("Enter the App key your builder shared with you.");
      return;
    }
    pending.current = new AbortController();
    setBusy(true);
    setError(null);
    try {
      const response = await transport.fetch(
        "/api/thread/apps?resolve_key=true",
        {
          headers: { "Aomi-App-Key": credential },
          signal: pending.current.signal,
        },
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new PrivateAppError(
            "This key is invalid or has been revoked. Ask the builder for a current key.",
          );
        if (response.status === 404 || response.status === 409)
          throw new PrivateAppError(
            "This app is unavailable. Ask its builder to activate it, then try again.",
          );
        if (response.status === 422)
          throw new PrivateAppError(
            "This key does not identify one private app. Ask the builder for its App key.",
          );
        throw new PrivateAppError("Couldn’t check the key. Please try again.");
      }
      const rows: unknown = await response.json();
      const app =
        Array.isArray(rows) && rows.length === 1
          ? normalizeAppDescriptor(rows[0])
          : null;
      if (!app || app.applicationId == null || app.isPublic !== false)
        throw new PrivateAppError(
          "Couldn’t resolve this key to a private app. Please try again later.",
        );
      if (
        (target?.applicationId != null &&
          String(app.applicationId) !== String(target.applicationId)) ||
        (target?.app && app.name !== target.app)
      )
        throw new PrivateAppError(
          "This key belongs to a different app. Enter the key shared for this app.",
        );
      if (app.isActive === false || app.artifactReady === false)
        throw new PrivateAppError(
          "This app isn’t ready yet. Ask its builder to check its deployment, then try again.",
        );
      if (!active.current) return;
      const existing =
        privateApps.apps.some(
          (saved) => String(saved.applicationId) === String(app.applicationId),
        ) ||
        (account?.user.application_ids ?? []).some(
          (id) => String(id) === String(app.applicationId),
        );
      if (account?.user.user_id) {
        const result = await installApp(
          app.applicationId,
          transport.json,
          credential,
        );
        updateAccountApps(account.user.user_id, result.apps, [
          ...new Set([
            ...(account.user.application_ids ?? []),
            Number(result.application_id),
          ]),
        ]);
      }
      if (!active.current) return;
      privateApps.add(app, credential);
      setKey("");
      setDuplicate(existing);
      setAdded(app);
      onAdded?.(app);
    } catch (cause) {
      // Install failures may contain an upstream body. Keep credentials and
      // implementation details out of the error message.
      if (!active.current) return;
      setError(
        cause instanceof PrivateAppError
          ? cause.message
          : "Couldn’t add this app. Check with its builder and try again.",
      );
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Add private app"
      description={
        added
          ? "Your app is ready in Library."
          : "Enter the key the app's builder shared with you."
      }
      confirmLabel={added ? "Done" : "Add app"}
      cancelLabel={added ? null : undefined}
      busy={busy}
      busyLabel="Adding app…"
      closeOnConfirm={false}
      onConfirm={() => {
        if (added) onClose();
        else void add();
      }}
    >
      {added ? (
        <div
          role="status"
          className="border-aomi-border bg-aomi-surface rounded-control mt-5 flex items-start gap-3 border p-4"
        >
          <Check className="text-aomi-success mt-0.5 size-5" />
          <div className="min-w-0">
            <p className="type-section break-words">
              {added.label || added.name}
            </p>
            <p className="type-meta text-aomi-muted mt-1">
              {duplicate
                ? "Already in your Library. Access updated."
                : "Added to Installed. Select it from the chat’s app picker."}
            </p>
            <p className="type-meta text-aomi-muted mt-2">
              App #{added.applicationId}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {(target?.app || target?.applicationId != null) && (
            <div className="border-aomi-border bg-aomi-surface rounded-control flex items-center gap-2.5 border px-3 py-2.5">
              <KeyRound className="text-aomi-muted size-4" />
              <span className="type-control truncate">
                {target?.app || `App #${target?.applicationId}`}
              </span>
            </div>
          )}
          <div>
            <label
              htmlFor={inputId}
              className="type-control mb-2 block font-medium"
            >
              App key
            </label>
            <div className="relative">
              <input
                id={inputId}
                type={showKey ? "text" : "password"}
                value={key}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                disabled={busy}
                placeholder="Paste your App key"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${inputId}-error` : undefined}
                onChange={(event) => {
                  setKey(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void add();
                  }
                }}
                className="border-aomi-border bg-aomi-surface focus:border-aomi-muted rounded-control h-11 w-full border pl-3 pr-11 text-base outline-none md:text-[14px]"
              />
              <AomiButton
                variant="ghost"
                size="icon"
                disabled={busy}
                className="absolute right-1 top-1.5"
                aria-label={showKey ? "Hide App key" : "Show App key"}
                onClick={() => setShowKey((value) => !value)}
              >
                {showKey ? <EyeOff /> : <Eye />}
              </AomiButton>
            </div>
          </div>
          {busy && (
            <p
              role="status"
              className="type-meta text-aomi-muted flex items-center gap-2"
            >
              <LoaderCircle className="size-3.5 animate-spin" />
              Checking app access…
            </p>
          )}
          {error && (
            <p
              id={`${inputId}-error`}
              role="alert"
              className="text-aomi-danger bg-aomi-danger/5 rounded-control type-control px-3 py-2.5"
            >
              {error}
            </p>
          )}
          <p className="type-meta text-aomi-muted">
            Your key stays private and is used only for this app.
          </p>
        </div>
      )}
    </ConfirmDialog>
  );
}
