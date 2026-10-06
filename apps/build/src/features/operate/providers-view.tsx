"use client";

// The global Providers page: builder-owned LLM model keys, provider-centric.
// One flat card per provider (header + divide-y key rows). Each key row is an
// accordion: click to expand an inline panel with key metadata, project
// assignment, and rotate/remove flows. Key material is write-only — only the
// stored prefix is ever shown.
//
// Styling follows the settings-redesign inventory, mapped onto apps/build's
// radius scale: rounded-md (12px) cards/tables, rounded-sm (8px) in-card
// controls, rounded-full pills. 10px uppercase tracked micro-labels, neutral
// badges for facts and sky-tinted badges for state, mono for key prefixes,
// and the button ramp (accent commit + accent repair in flow, solid red pill
// for the destructive commit).

import { Check, ChevronDown, KeyRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useGitHubSession } from "@/components/control-plane/github-session-context";
import {
  GitHubSignInPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "@/features/deploy/query-keys";
import { modelKeysFetch } from "@/features/operate/client";
import { API_PATHS } from "@/lib/api-paths";
import { cn } from "@/lib/class-names";
import { readJsonResponse } from "@/lib/request-retry";

export const PROVIDERS = ["openai", "anthropic", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

export type ModelKeyUsage = {
  tokens?: number;
  costUsd?: number;
};

export type ModelKeyAppUsage = {
  applicationId: number;
  inputTokens: number;
  outputTokens: number;
  costCredits: number;
  turns: number;
};

export type ModelKey = {
  id: number;
  provider: string;
  label: string | null;
  keyPrefix: string;
  createdAt: number;
  updatedAt: number;
  applicationIds: number[];
  /** Wire form from the BFF: all-time funded-turn sums per application. */
  usageByApplication?: ModelKeyAppUsage[];
  /** applicationId -> usage, derived from `usageByApplication` on load. */
  usage?: Record<number, ModelKeyUsage>;
};

const USD_PER_CREDIT = 0.01;

export function withUsage(key: ModelKey): ModelKey {
  const rows = key.usageByApplication ?? [];
  if (rows.length === 0) return key;
  const usage: Record<number, ModelKeyUsage> = {};
  for (const row of rows) {
    usage[row.applicationId] = {
      tokens: row.inputTokens + row.outputTokens,
      costUsd: row.costCredits * USD_PER_CREDIT,
    };
  }
  return { ...key, usage };
}

export type KeySource = {
  id: number;
  repositoryLink?: string | null;
  githubAccount?: string | null;
  apps?: { id: number; name: string }[];
};

export type ProvidersPayload = {
  projects?: KeySource[];
  keys?: ModelKey[];
};

export function keyDisplayName(key: ModelKey): string {
  return key.label?.trim() || `${key.keyPrefix}…`;
}

function formatTs(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

const tokensCell = (count?: number) =>
  count === undefined ? "—" : formatTokens(count);
const costCell = (usd?: number) =>
  usd === undefined ? "—" : `$${usd.toFixed(2)}`;

function sumUsage(
  options: AppOption[],
  usage: ModelKey["usage"],
): { tokens?: number; costUsd?: number } {
  const total: { tokens?: number; costUsd?: number } = {};
  for (const option of options) {
    const entry = usage?.[option.applicationId];
    if (entry?.tokens !== undefined)
      total.tokens = (total.tokens ?? 0) + entry.tokens;
    if (entry?.costUsd !== undefined)
      total.costUsd = (total.costUsd ?? 0) + entry.costUsd;
  }
  return total;
}

type AppOption = { applicationId: number; name: string; projectLabel: string };

function appOptions(projects: KeySource[]): AppOption[] {
  return projects.flatMap((source) =>
    (source.apps ?? []).map((app) => ({
      applicationId: app.id,
      name: app.name,
      projectLabel:
        source.repositoryLink || source.githubAccount || `Source ${source.id}`,
    })),
  );
}

const COMMIT_BTN =
  "bg-accent-selected text-accent-selected-foreground hover:opacity-90 inline-flex h-8 items-center justify-center rounded-sm px-3.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50";
const REPAIR_BTN =
  "border-accent-selected/50 text-accent-selected hover:bg-accent-selected/10 inline-flex h-8 items-center gap-1 rounded-sm border px-3 text-[13px] font-medium disabled:opacity-50";
const OUTLINE_BTN =
  "border-border hover:bg-surface-2 text-foreground inline-flex h-7 items-center rounded-sm border px-2.5 text-xs font-medium disabled:opacity-50";
const GHOST_BTN =
  "text-dim hover:text-foreground inline-flex h-8 items-center rounded-sm px-2.5 text-[13px]";
const DANGER_BTN =
  "bg-destructive text-destructive-foreground hover:opacity-90 inline-flex h-8 items-center rounded-full px-4 text-[13px] font-medium disabled:opacity-50";
const INPUT =
  "bg-input text-foreground placeholder:text-dim h-8 rounded-sm border border-border px-2.5 text-[13px]";
const TH =
  "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-dim";

const BADGE =
  "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] whitespace-nowrap";

function StatusBadge({ projectCount }: { projectCount: number }) {
  return projectCount > 0 ? (
    <span
      className={cn(
        BADGE,
        "border-accent-selected/40 bg-accent-selected/10 text-accent-selected",
      )}
    >
      Active · {projectCount} project{projectCount === 1 ? "" : "s"}
    </span>
  ) : (
    <span className={cn(BADGE, "border-border bg-surface-2 text-dim")}>
      Unassigned
    </span>
  );
}

function CheckboxGlyph({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked
          ? "bg-accent-selected text-accent-selected-foreground border-transparent"
          : "border-border-hover bg-transparent",
      )}
    >
      {checked ? <Check className="size-3" /> : null}
    </span>
  );
}

function FundingSummary({
  keyRow,
  options,
  fundedNames,
  rotateDisabled,
  onRotate,
  removeDisabled,
  onRemove,
}: {
  keyRow: ModelKey;
  options: AppOption[];
  fundedNames: string[];
  rotateDisabled: boolean;
  onRotate: () => void;
  removeDisabled: boolean;
  onRemove: () => void;
}) {
  const total = sumUsage(options, keyRow.usage);
  const projectCount = fundedNames.length;
  const rotated = keyRow.updatedAt > keyRow.createdAt;

  return (
    <section className="border-border bg-surface-2/70 overflow-hidden rounded-md border">
      <div className="px-3.5 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  projectCount > 0 ? "bg-positive" : "bg-dim",
                )}
              />
              <h3 className="text-[13px] font-medium">
                {projectCount > 0
                  ? `Sponsoring ${projectCount} project${projectCount === 1 ? "" : "s"}`
                  : "Ready to sponsor model usage"}
              </h3>
            </div>
            <p className="text-dim mt-1 max-w-2xl text-xs leading-relaxed">
              {projectCount > 0 ? (
                <>
                  Provider spend for{" "}
                  <span className="text-foreground">
                    {fundedNames.join(", ")}
                  </span>{" "}
                  routes through this key, so their users aren&apos;t charged
                  model cost.
                </>
              ) : (
                <>
                  Assign a project below to route its provider spend through
                  this key and waive model cost for its users.
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={rotateDisabled}
              onClick={onRotate}
              className={cn(REPAIR_BTN, "h-7 px-2.5")}
            >
              Rotate
            </button>
            <button
              type="button"
              disabled={removeDisabled}
              onClick={onRemove}
              className={cn(DANGER_BTN, "h-7 rounded-sm px-2.5")}
            >
              Remove
            </button>
          </div>
        </div>
      </div>

      <dl className="border-border grid grid-cols-3 divide-x border-y">
        <div className="bg-surface-1 px-3 py-2.5">
          <dt className="text-dim text-[10px] font-semibold uppercase tracking-[0.07em]">
            Projects funded
          </dt>
          <dd className="text-foreground mt-0.5 font-mono text-base font-medium tabular-nums">
            {projectCount}
          </dd>
        </div>
        <div className="bg-surface-1 px-3 py-2.5">
          <dt className="text-dim text-[10px] font-semibold uppercase tracking-[0.07em]">
            Tokens sponsored
          </dt>
          <dd className="text-foreground mt-0.5 font-mono text-base font-medium tabular-nums">
            {tokensCell(total.tokens)}
          </dd>
        </div>
        <div className="bg-surface-1 px-3 py-2.5">
          <dt className="text-dim text-[10px] font-semibold uppercase tracking-[0.07em]">
            Provider spend
          </dt>
          <dd className="text-foreground mt-0.5 font-mono text-base font-medium tabular-nums">
            {costCell(total.costUsd)}
          </dd>
        </div>
      </dl>

      <div className="text-dim flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-[11px]">
        <span className="font-mono">{keyRow.keyPrefix}…</span>
        <span>Added {formatTs(keyRow.createdAt)}</span>
        {rotated ? <span>Rotated {formatTs(keyRow.updatedAt)}</span> : null}
        <span className="ml-auto">Usage totals · all time</span>
      </div>
    </section>
  );
}

function ProjectsTable({
  keyRow,
  options,
  fundedBy,
  checked,
  onToggle,
}: {
  keyRow: ModelKey;
  options: AppOption[];
  fundedBy: Map<number, ModelKey>;
  checked: Set<number>;
  onToggle: (applicationId: number, isChecked: boolean) => void;
}) {
  const total = sumUsage(options, keyRow.usage);
  return (
    <div className="bg-surface-1 overflow-x-auto">
      <table className="w-full min-w-[640px] table-fixed text-[13px]">
        <thead className="border-border border-b">
          <tr>
            <th className={TH}>Project</th>
            <th className={TH}>Source</th>
            <th className={TH}>Funded by</th>
            <th className={cn(TH, "text-right")}>Tokens</th>
            <th className={cn(TH, "text-right")}>Cost</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {options.map((option) => {
            const isChecked = checked.has(option.applicationId);
            const holder = fundedBy.get(option.applicationId);
            const stolen = holder && holder.id !== keyRow.id && isChecked;
            return (
              <tr
                key={option.applicationId}
                className="hover:bg-surface-2/60 transition-colors"
              >
                <td className="px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isChecked}
                      onChange={(event) =>
                        onToggle(option.applicationId, event.target.checked)
                      }
                    />
                    <CheckboxGlyph checked={isChecked} />
                    <span className="text-foreground truncate">
                      {option.name}
                    </span>
                  </label>
                </td>
                <td className="text-dim truncate px-3 py-2 text-xs">
                  {option.projectLabel}
                </td>
                <td className="px-3 py-2 text-xs">
                  {stolen ? (
                    <span className="text-warning">
                      {keyDisplayName(holder)} — reassigns on save
                    </span>
                  ) : holder ? (
                    holder.id === keyRow.id ? (
                      <span className="text-foreground">This key</span>
                    ) : (
                      <span className="text-dim">{keyDisplayName(holder)}</span>
                    )
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
                <td className="text-dim whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                  {tokensCell(keyRow.usage?.[option.applicationId]?.tokens)}
                </td>
                <td className="text-dim whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                  {costCell(keyRow.usage?.[option.applicationId]?.costUsd)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-border bg-surface-1 border-t">
          <tr>
            <td className="text-foreground px-3 py-2 font-medium">Total</td>
            <td />
            <td />
            <td className="text-foreground px-3 py-2 text-right font-mono text-xs font-medium">
              {tokensCell(total.tokens)}
            </td>
            <td className="text-foreground px-3 py-2 text-right font-mono text-xs font-medium">
              {costCell(total.costUsd)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function KeyRow({
  keyRow,
  options,
  fundedBy,
  onGrants,
  onRotate,
  onRemove,
  busy,
}: {
  keyRow: ModelKey;
  options: AppOption[];
  fundedBy: Map<number, ModelKey>;
  onGrants: (key: ModelKey, applicationIds: number[]) => Promise<void>;
  onRotate: (key: ModelKey, material: string) => Promise<void>;
  onRemove: (key: ModelKey) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(keyRow.applicationIds),
  );
  const [flow, setFlow] = useState<"rotate" | "remove" | null>(null);
  const [material, setMaterial] = useState("");

  useEffect(() => {
    setChecked(new Set(keyRow.applicationIds));
  }, [keyRow.applicationIds]);

  const dirty =
    checked.size !== keyRow.applicationIds.length ||
    keyRow.applicationIds.some((id) => !checked.has(id));
  const projectCount = keyRow.applicationIds.length;
  /** Names of the projects this key funds, so the closed row answers
   *  "which ones?" without being expanded. */
  const fundedNames = useMemo(
    () =>
      options
        .filter((option) =>
          keyRow.applicationIds.includes(option.applicationId),
        )
        .map((option) => option.name),
    [options, keyRow.applicationIds],
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setFlow(null);
          setMaterial("");
          setChecked(new Set(keyRow.applicationIds));
        }}
        aria-expanded={open}
        className="hover:bg-surface-2/60 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate font-mono text-sm font-medium">
              {keyDisplayName(keyRow)}
            </span>
            {/* The prefix is identity, so it sits with the name — but only
                when a label exists, else it would just repeat the name. */}
            {keyRow.label?.trim() ? (
              <span className="text-dim shrink-0 font-mono text-xs">
                {keyRow.keyPrefix}…
              </span>
            ) : null}
            <StatusBadge projectCount={projectCount} />
          </div>
        </div>
        <ChevronDown
          className={cn(
            "text-dim size-4 shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="space-y-3.5 px-6 pb-5">
          <FundingSummary
            keyRow={keyRow}
            options={options}
            fundedNames={fundedNames}
            rotateDisabled={busy || flow !== null}
            onRotate={() => {
              setMaterial("");
              setFlow("rotate");
            }}
            removeDisabled={busy || flow !== null}
            onRemove={() => setFlow("remove")}
          />

          {flow === "rotate" ? (
            <div className="border-accent-selected/30 bg-accent rounded-sm border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  autoFocus
                  value={material}
                  onChange={(event) => setMaterial(event.target.value)}
                  placeholder="Paste the new key — assignments are kept"
                  className={cn(INPUT, "min-w-[220px] flex-1")}
                />
                <button
                  type="button"
                  disabled={!material.trim() || busy}
                  onClick={() =>
                    void onRotate(keyRow, material.trim()).then(() => {
                      setMaterial("");
                      setFlow(null);
                    })
                  }
                  className={COMMIT_BTN}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setFlow(null)}
                  className={GHOST_BTN}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : flow === "remove" ? (
            <div className="border-destructive/30 bg-destructive/5 rounded-sm border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-dim min-w-0 flex-1 text-xs leading-snug">
                  {projectCount > 0 ? (
                    <>
                      This key currently funds{" "}
                      <span className="text-foreground">
                        {projectCount} project
                        {projectCount === 1 ? "" : "s"}
                      </span>
                      ; they fall back to platform keys. This can&apos;t be
                      undone.
                    </>
                  ) : (
                    <>This key is unassigned. This can&apos;t be undone.</>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setFlow(null)}
                  className={GHOST_BTN}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRemove(keyRow)}
                  className={DANGER_BTN}
                >
                  {busy ? "Removing…" : "Remove key"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="pt-2">
            <div className="mb-2">
              <h4 className="text-sm font-medium">Add to project</h4>
              <p className="text-dim mt-1.5 text-xs">
                Use this key to fund projects when users select models from this
                provider.
              </p>
            </div>
            {options.length === 0 ? (
              <p className="text-dim text-xs">
                No deployed projects available for this account.
              </p>
            ) : (
              <ProjectsTable
                keyRow={keyRow}
                options={options}
                fundedBy={fundedBy}
                checked={checked}
                onToggle={(applicationId, isChecked) => {
                  setChecked((current) => {
                    const next = new Set(current);
                    if (isChecked) next.add(applicationId);
                    else next.delete(applicationId);
                    return next;
                  });
                }}
              />
            )}
            {dirty ? (
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setChecked(new Set(keyRow.applicationIds))}
                  className={GHOST_BTN}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onGrants(keyRow, [...checked])}
                  className={COMMIT_BTN}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProviderSection({
  provider,
  keys,
  options,
  onCreate,
  onGrants,
  onRotate,
  onRemove,
  busy,
}: {
  provider: Provider;
  keys: ModelKey[];
  options: AppOption[];
  onCreate: (
    provider: Provider,
    material: string,
    label: string,
  ) => Promise<void>;
  onGrants: (key: ModelKey, applicationIds: number[]) => Promise<void>;
  onRotate: (key: ModelKey, material: string) => Promise<void>;
  onRemove: (key: ModelKey) => Promise<void>;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [material, setMaterial] = useState("");
  const [label, setLabel] = useState("");
  const fundedBy = useMemo(() => {
    const map = new Map<number, ModelKey>();
    for (const key of keys) {
      for (const id of key.applicationIds) map.set(id, key);
    }
    return map;
  }, [keys]);

  const closeForm = () => {
    setMaterial("");
    setLabel("");
    setAdding(false);
  };

  return (
    <section className="border-border bg-surface-1 rounded-md border">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <h2 className="text-[13px] font-medium">{PROVIDER_LABELS[provider]}</h2>
        <span className="text-dim text-[11px]">
          {keys.length === 0
            ? "No keys"
            : `${keys.length} key${keys.length === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          onClick={() => (adding ? closeForm() : setAdding(true))}
          disabled={busy}
          aria-expanded={adding}
          className={cn(OUTLINE_BTN, "ml-auto", adding && "bg-surface-2")}
        >
          + Add key
        </button>
      </div>

      {adding || keys.length > 0 ? (
        <div className="divide-border border-border divide-y border-t">
          {adding ? (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Label (optional), e.g. prod-main"
                className={cn(INPUT, "w-52")}
              />
              <input
                type="password"
                autoFocus
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
                placeholder={`Paste your ${PROVIDER_LABELS[provider]} API key`}
                className={cn(INPUT, "min-w-[220px] flex-1")}
              />
              <button
                type="button"
                disabled={!material.trim() || busy}
                onClick={() =>
                  void onCreate(provider, material.trim(), label.trim()).then(
                    closeForm,
                  )
                }
                className={COMMIT_BTN}
              >
                {busy ? "Adding…" : "Add key"}
              </button>
              <button type="button" onClick={closeForm} className={GHOST_BTN}>
                Cancel
              </button>
            </div>
          ) : null}

          {keys.map((key) => (
            <KeyRow
              key={key.id}
              keyRow={key}
              options={options}
              fundedBy={fundedBy}
              onGrants={onGrants}
              onRotate={onRotate}
              onRemove={onRemove}
              busy={busy}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ProvidersView() {
  const { account } = useGitHubSession();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const accountKey = githubAccountKey(account.githubLogin);
  const providers = useQuery({
    queryKey: buildQueryKeys.modelKeys(accountKey ?? "unavailable"),
    queryFn: () => modelKeysFetch<ProvidersPayload>(),
    select: (payload) => ({
      ...payload,
      keys: (payload.keys ?? []).map(withUsage),
    }),
    enabled: account.signedIn && accountKey !== null,
    staleTime: buildQueryStaleTime.modelKeys,
  });
  const payload = providers.data ?? null;
  const loading = providers.isPending;
  const error =
    providers.error && !providers.data
      ? providers.error instanceof Error
        ? providers.error.message
        : String(providers.error)
      : null;
  const reload = providers.refetch;

  const options = useMemo(
    () => appOptions(payload?.projects ?? []),
    [payload?.projects],
  );
  const keysByProvider = useMemo(() => {
    const map = new Map<string, ModelKey[]>();
    for (const key of payload?.keys ?? []) {
      map.set(key.provider, [...(map.get(key.provider) ?? []), key]);
    }
    return map;
  }, [payload?.keys]);

  const run = useCallback(
    async (op: () => Promise<Response>) => {
      setBusy(true);
      setFormError(null);
      try {
        const res = await op();
        await readJsonResponse(res, "Failed");
        await reload();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const onCreate = useCallback(
    (provider: Provider, material: string, label: string) =>
      run(() =>
        fetch(API_PATHS.bff.operate.modelKeys, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            key: material,
            label: label || undefined,
          }),
        }),
      ),
    [run],
  );
  const onRotate = useCallback(
    (key: ModelKey, material: string) =>
      run(() =>
        fetch(API_PATHS.bff.operate.modelKeys, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyId: key.id,
            provider: key.provider,
            key: material,
            label: key.label ?? undefined,
          }),
        }),
      ),
    [run],
  );
  const onGrants = useCallback(
    (key: ModelKey, applicationIds: number[]) =>
      run(() =>
        fetch(API_PATHS.bff.operate.modelKeys, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyId: key.id, applicationIds }),
        }),
      ),
    [run],
  );
  const onRemove = useCallback(
    (key: ModelKey) =>
      run(() =>
        fetch(`${API_PATHS.bff.operate.modelKeys}?keyId=${key.id}`, {
          method: "DELETE",
        }),
      ),
    [run],
  );

  if (account.loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <LoadingPanel label="Checking GitHub session..." />
      </div>
    );
  }
  if (!account.signedIn) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <GitHubSignInPanel error={null} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <div className="flex items-center gap-2">
          <KeyRound className="text-dim size-5" aria-hidden />
          <h1 className="font-display text-xl font-normal tracking-tight">
            Providers
          </h1>
        </div>
        <p className="text-dim mt-1.5 max-w-3xl text-sm leading-5">
          Your keys fund inference for your apps&apos; users — model cost is
          waived when a key covers their selected model.
        </p>
        <p className="text-dim mt-1 max-w-3xl text-xs leading-5">
          Keys are encrypted and never shown again. App tool secrets live in
          each project&apos;s Environment.
        </p>
      </header>

      {formError ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-[13px]">
          {formError}
        </div>
      ) : null}

      {loading ? (
        <div className="border-border bg-surface-1 text-dim rounded-md border px-4 py-10 text-center text-[13px]">
          Loading
        </div>
      ) : error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-4 py-3 text-[13px]">
          {error}
        </div>
      ) : (
        PROVIDERS.map((provider) => (
          <ProviderSection
            key={provider}
            provider={provider}
            keys={keysByProvider.get(provider) ?? []}
            options={options}
            onCreate={onCreate}
            onGrants={onGrants}
            onRotate={onRotate}
            onRemove={onRemove}
            busy={busy}
          />
        ))
      )}
    </div>
  );
}
