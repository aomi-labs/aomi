"use client";

// Project-scoped lens on the builder's provider keys: which providers fund
// THIS project's apps, via which key. Read-mostly — apply/remove toggles
// grants for this project's apps; key management (add/rotate/remove) lives
// on the global Providers page.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";
import { API_PATHS } from "@build/lib/api-paths";
import {
  keyDisplayName,
  PROVIDER_LABELS,
  PROVIDERS,
  withUsage,
  type ModelKey,
  type Provider,
  type ProvidersPayload,
} from "@build/features/operate/providers-view";

type Detail = ReturnType<typeof useProjectDetail>;

// Shared recipes from the settings-redesign inventory, mapped onto apps/build's
// tokens: 10px uppercase tracked column heads (No 02) and badges (No 03) —
// neutral for facts, sky tint for a funding state.
const TH =
  "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-dim";
const BADGE =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] whitespace-nowrap";
const BADGE_ACCENT =
  "border-accent-selected/40 bg-accent-selected/10 text-accent-selected";
const BADGE_NEUTRAL = "border-border bg-surface-2 text-dim";
/** Quiet in-card row action: neutral outline, rounded-sm. */
const ROW_BTN =
  "border-border hover:bg-surface-2 text-foreground inline-flex h-7 items-center rounded-sm border px-2.5 text-xs font-medium disabled:opacity-50";

export function ProvidersTab({ detail }: { detail: Detail }) {
  const [keys, setKeys] = useState<ModelKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const appIds = useMemo(
    () => (detail.source?.apps ?? []).map((app: { id: number }) => app.id),
    [detail.source?.apps],
  );

  const reload = useCallback(async () => {
    const res = await fetch(API_PATHS.bff.operate.modelKeys);
    const json = (await res.json().catch(() => ({}))) as ProvidersPayload & {
      error?: string;
    };
    if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
    setKeys((json.keys ?? []).map(withUsage));
  }, []);

  useEffect(() => {
    reload().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [reload]);

  /** The key funding any of this project's apps for `provider`, if any. */
  const fundingKey = useCallback(
    (provider: Provider): ModelKey | undefined =>
      (keys ?? []).find(
        (key) =>
          key.provider === provider &&
          key.applicationIds.some((id) => appIds.includes(id)),
      ),
    [keys, appIds],
  );

  /** Any key of this provider the builder owns (candidate to apply). */
  const candidateKey = useCallback(
    (provider: Provider): ModelKey | undefined =>
      (keys ?? []).find((key) => key.provider === provider),
    [keys],
  );

  const setGrants = useCallback(
    async (key: ModelKey, applicationIds: number[]) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(API_PATHS.bff.operate.modelKeys, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyId: key.id, applicationIds }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const apply = useCallback(
    (key: ModelKey) =>
      setGrants(key, [...new Set([...key.applicationIds, ...appIds])]),
    [setGrants, appIds],
  );
  const remove = useCallback(
    (key: ModelKey) =>
      setGrants(
        key,
        key.applicationIds.filter((id) => !appIds.includes(id)),
      ),
    [setGrants, appIds],
  );

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-base font-medium">Providers</h2>
        <p className="text-dim mt-1 text-sm">
          Providers funding this project&apos;s users — their model cost is
          waived when your key covers their selected model. Manage keys on the{" "}
          <Link href="/providers" className="text-link hover:underline">
            Providers page
          </Link>
          . App tool secrets live in Environment, not here.
        </p>
      </div>

      {error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      {keys === null ? (
        <div className="border-border bg-surface-2 text-dim rounded-md border px-4 py-8 text-center text-sm">
          Loading
        </div>
      ) : (
        <div className="border-border bg-surface-1 overflow-x-auto rounded-md border">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>Provider</th>
                <th className={TH}>Status</th>
                <th className={TH}>Key</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {PROVIDERS.map((provider) => {
                const funded = fundingKey(provider);
                const candidate = candidateKey(provider);
                return (
                  <tr key={provider} className="border-border border-t">
                    <td className="text-foreground px-3 py-2.5">
                      {PROVIDER_LABELS[provider]}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`${BADGE} ${funded ? BADGE_ACCENT : BADGE_NEUTRAL}`}
                      >
                        {funded ? "Funding" : "Not applied"}
                      </span>
                    </td>
                    <td className="text-dim px-3 py-2.5 font-mono text-xs">
                      {funded
                        ? `${keyDisplayName(funded)} (${funded.keyPrefix}…)`
                        : candidate
                          ? `${keyDisplayName(candidate)} available`
                          : "No key saved"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {funded ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(funded)}
                          className={ROW_BTN}
                        >
                          Remove from project
                        </button>
                      ) : candidate ? (
                        <button
                          type="button"
                          disabled={busy || appIds.length === 0}
                          onClick={() => void apply(candidate)}
                          className={ROW_BTN}
                        >
                          Apply to project
                        </button>
                      ) : (
                        <Link
                          href="/providers"
                          className="text-link text-xs hover:underline"
                        >
                          Add a key
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
