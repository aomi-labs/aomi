"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import type { BuilderAppKey } from "@aomi-labs/deploy";
import { useToast } from "@/components/control-plane/toast";
import { buildFetch } from "@/lib/session-expiry";
import { ConfirmDialog } from "./ui/confirm-dialog";

const APP_KEY_PATH = "/api/build/deployments/app-key";

async function appKeyRequest(
  applicationId: number,
  regenerate: boolean,
): Promise<BuilderAppKey | null> {
  const response = regenerate
    ? await buildFetch(APP_KEY_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId }),
      })
    : await buildFetch(`${APP_KEY_PATH}?applicationId=${applicationId}`, {
        cache: "no-store",
      });
  const body = (await response.json().catch(() => ({}))) as {
    appKey?: BuilderAppKey | null;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error ?? `request failed (${response.status})`);
  }
  return body.appKey ?? null;
}

/** Show a key's prefix and hide the rest. */
export function maskAppKey(key: string, prefix: string): string {
  return `${prefix}${"•".repeat(Math.max(8, Math.min(24, key.length - prefix.length)))}`;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; appKey: BuilderAppKey | null }
  | { kind: "error"; message: string };

/**
 * The key a builder shares so other people can use a private App in Chat.
 * The builder can view and copy it at any time, and regenerate it, which
 * revokes the old key for everyone holding it.
 */
export function AppKeyPanel({
  applicationId,
  appName,
}: {
  applicationId: number;
  appName: string;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setRevealed(false);
    appKeyRequest(applicationId, false)
      .then((appKey) => {
        if (!cancelled) setState({ kind: "ready", appKey });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            kind: "error",
            message:
              err instanceof Error ? err.message : "Could not load the key.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  const regenerate = useCallback(async () => {
    setConfirming(false);
    setBusy(true);
    try {
      const appKey = await appKeyRequest(applicationId, true);
      setState({ kind: "ready", appKey });
      setRevealed(true);
      toast({ title: "New app key ready", tone: "success" });
    } catch {
      toast({ title: "Could not generate a key. Retry", tone: "error" });
    } finally {
      setBusy(false);
    }
  }, [applicationId, toast]);

  const copy = useCallback(
    async (key: string) => {
      try {
        await navigator.clipboard.writeText(key);
        toast({ title: "Copied", tone: "success" });
      } catch {
        toast({ title: "Could not copy the key", tone: "error" });
      }
    },
    [toast],
  );

  const appKey = state.kind === "ready" ? state.appKey : null;

  return (
    <div className="border-border bg-surface-1 rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="text-dim size-4 shrink-0" aria-hidden />
          <div className="text-sm font-medium">App key</div>
        </div>
        {state.kind === "ready" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => (appKey ? setConfirming(true) : void regenerate())}
            className="border-border bg-surface-2 hover:bg-accent-hover inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {appKey ? "Regenerate" : "Generate key"}
          </button>
        )}
      </div>
      <p className="text-dim mt-2 text-xs leading-5">
        <span className="font-mono">{appName}</span> is private. Share this key
        with the people who should use it in Chat; they enter it once from the
        key button in the composer.
      </p>
      {state.kind === "loading" && (
        <div className="text-dim mt-2 text-xs">Loading key…</div>
      )}
      {state.kind === "error" && (
        <div className="text-destructive mt-2 text-xs">{state.message}</div>
      )}
      {appKey && (
        <div className="mt-2 flex items-center gap-1">
          <code
            className="border-border bg-surface-2 min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 font-mono text-xs"
            data-testid="app-key-value"
          >
            {revealed ? appKey.key : maskAppKey(appKey.key, appKey.keyPrefix)}
          </code>
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? "Hide app key" : "Reveal app key"}
            className="hover:bg-accent-hover inline-flex size-7 items-center justify-center rounded-md"
          >
            {revealed ? (
              <EyeOff className="size-3.5" aria-hidden />
            ) : (
              <Eye className="size-3.5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => void copy(appKey.key)}
            aria-label="Copy app key"
            className="hover:bg-accent-hover inline-flex size-7 items-center justify-center rounded-md"
          >
            <Copy className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Regenerate app key?"
        body="The current key stops working right away for everyone using it. Share the new key with them."
        confirmLabel="Regenerate"
        onConfirm={() => void regenerate()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
