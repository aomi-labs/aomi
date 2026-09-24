"use client";
import { useShellTransport } from "../../transport";

import {
  createElement,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  KeyRound,
  Loader2,
  MessageCircle,
  Network,
  Sparkles,
  Trash2,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { getChainIcon, getSkillIcon } from "../../../icons";
import {
  appSecretsReady,
  useAppSecretsState,
} from "../../../app-secrets/use-app-secrets-state";
import {
  fetchSkillDetail,
  skillLabel,
  type SkillDetail,
  type SkillSummary,
} from "../../../../lib/capabilities/skill-catalog";
import { PackageIcon } from "./package-row";
import {
  isPackageAvailableOnChain,
  type CatalogPackage,
} from "./packages-catalog";
import {
  fetchAppSecrets,
  removeAppSecret,
  saveAppSecrets,
} from "./packages-api";

export type LibrarySelection =
  | { kind: "app"; item: CatalogPackage }
  | { kind: "skill"; item: SkillSummary };

const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  143: "Monad",
  8453: "Base",
  42161: "Arbitrum",
  5_042_002: "Arc",
};

export function chainLabel(id: number): string {
  return CHAIN_LABELS[id] ?? `Chain ${id}`;
}

export function SkillIdentity({
  skillId,
  size = "row",
}: {
  skillId: string;
  size?: "row" | "detail";
}) {
  const Icon = getSkillIcon(skillId) ?? WandSparkles;
  return (
    <span
      className={`border-aomi-overlay-border bg-aomi-surface-2 text-aomi-accent flex shrink-0 items-center justify-center rounded-xl border ${
        size === "detail" ? "size-12" : "size-9"
      }`}
    >
      {createElement(Icon, {
        className: size === "detail" ? "size-7" : "size-5",
      })}
    </span>
  );
}

export function ChainMarks({
  chainIds,
  expanded = false,
}: {
  chainIds: number[];
  expanded?: boolean;
}) {
  if (chainIds.length === 0) {
    return (
      <span className="text-aomi-muted whitespace-nowrap text-[11px]">
        Any network
      </span>
    );
  }

  const shown = expanded ? chainIds : chainIds.slice(0, 3);
  return (
    <span className="flex min-w-0 items-center">
      <span className="flex -space-x-1.5">
        {shown.map((chainId) => {
          const Icon = getChainIcon(chainId);
          return (
            <span
              key={chainId}
              title={chainLabel(chainId)}
              className="border-aomi-raised bg-aomi-surface-2 flex size-5 items-center justify-center rounded-full border"
            >
              {Icon ? (
                <Icon className="size-3" />
              ) : (
                <Network className="text-aomi-muted size-2.5" />
              )}
            </span>
          );
        })}
      </span>
      {!expanded && chainIds.length > shown.length ? (
        <span className="text-aomi-muted ml-1 text-[10px]">
          +{chainIds.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-aomi-border border-t pt-5">
      <h3 className="text-aomi-muted text-[11px] font-medium uppercase tracking-[0.12em]">
        {title}
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function AppSecretSetup({
  app,
  accountUserId,
  installed,
  appBusy,
  available,
  onInstall,
}: {
  app: CatalogPackage;
  accountUserId?: string;
  installed: boolean;
  appBusy: boolean;
  available: boolean;
  onInstall: () => Promise<boolean>;
}) {
  const { json: request } = useShellTransport();
  const applicationId = app.applicationId;
  const scope = `${accountUserId ?? "signed-out"}:${String(applicationId ?? "")}`;
  const operations = useMemo(
    () => ({
      list: (id: number | string) => fetchAppSecrets(id, request),
      save: (id: number | string, secrets: Record<string, string>) =>
        saveAppSecrets(id, secrets, request),
      remove: (id: number | string, name: string) =>
        removeAppSecret(id, name, request),
    }),
    [request],
  );
  const secretState = useAppSecretsState({
    scopeKey: scope,
    applicationId,
    enabled: Boolean(accountUserId && applicationId != null),
    declaredSlots: app.secrets,
    operations,
  });
  const {
    status,
    slots,
    drafts,
    setDraft,
    hasPending,
    loading,
    busyName,
    error,
    setError,
  } = secretState;
  const declaredNames = useMemo(
    () => new Set(app.secrets.map((slot) => slot.name)),
    [app.secrets],
  );
  const draftReady = slots.every(
    (slot) =>
      !slot.required || slot.configured || Boolean(drafts[slot.name]?.trim()),
  );
  const ready = status ? appSecretsReady(status) : false;
  const busy = appBusy || secretState.busy;

  const activate = async () => {
    const next = hasPending ? await secretState.save() : status;
    if (hasPending && !next) return;
    if (!next || !appSecretsReady(next)) {
      setError("Add every required credential before activating this app.");
      return;
    }
    await onInstall();
  };

  if (!loading && slots.length === 0) return null;

  return (
    <DetailSection title="Setup">
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <KeyRound className="text-aomi-muted mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[12px] leading-5">
              Use your own credentials for this app. Saved values are never
              shown again.
            </p>
            {accountUserId ? (
              <p className="text-aomi-muted mt-0.5 text-[11px]">
                {loading
                  ? "Checking setup…"
                  : ready
                    ? "Ready to use"
                    : "Setup required"}
              </p>
            ) : (
              <p className="text-aomi-danger mt-0.5 text-[11px]">
                Sign in to save credentials and add this app.
              </p>
            )}
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="bg-aomi-surface-2 text-aomi-danger flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[11px]"
          >
            <span>{error}</span>
            {accountUserId && status === null ? (
              <button
                type="button"
                onClick={() => void secretState.retry()}
                disabled={loading}
                className="text-aomi-fg shrink-0 font-medium disabled:opacity-50"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {slots.map((slot) => {
          const obsolete = !declaredNames.has(slot.name);
          return (
            <div key={slot.name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={`library-secret-${app.id}-${slot.name}`}
                  className="min-w-0 truncate font-mono text-[11px] font-medium"
                >
                  {slot.name}
                </label>
                <span className="text-aomi-muted shrink-0 text-[10px]">
                  {obsolete
                    ? "No longer used · Saved"
                    : slot.configured
                      ? `${slot.required ? "Required" : "Optional"} · Saved`
                      : slot.required
                        ? "Required"
                        : "Optional"}
                </span>
              </div>
              {slot.description ? (
                <p className="text-aomi-muted text-[11px] leading-4">
                  {slot.description}
                </p>
              ) : null}
              <div className="flex gap-1.5">
                {!obsolete ? (
                  <input
                    id={`library-secret-${app.id}-${slot.name}`}
                    aria-label={slot.name}
                    type="password"
                    autoComplete="new-password"
                    value={drafts[slot.name] ?? ""}
                    placeholder={
                      slot.configured ? "Enter replacement" : "Enter value"
                    }
                    disabled={busy || !accountUserId}
                    onChange={(event) =>
                      setDraft(slot.name, event.target.value)
                    }
                    className="border-aomi-border bg-aomi-bg placeholder:text-aomi-muted min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-[12px] outline-none focus:border-current disabled:opacity-50"
                  />
                ) : (
                  <p className="text-aomi-muted min-w-0 flex-1 py-2 text-[11px]">
                    This saved credential can only be removed.
                  </p>
                )}
                {slot.configured ? (
                  <button
                    type="button"
                    aria-label={`Remove ${slot.name}`}
                    title={`Remove ${slot.name}`}
                    disabled={busy}
                    onClick={() => void secretState.remove(slot.name)}
                    className="border-aomi-border text-aomi-muted hover:bg-aomi-hover hover:text-aomi-danger flex size-9 shrink-0 items-center justify-center rounded-lg border disabled:opacity-50"
                  >
                    {busyName === slot.name ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {installed ? (
          <button
            type="button"
            onClick={() => void secretState.save()}
            disabled={busy || !hasPending}
            className="bg-aomi-fg text-aomi-bg flex h-9 w-full items-center justify-center rounded-lg text-[12px] font-medium disabled:opacity-40"
          >
            {busyName === "save" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Save changes"
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void activate()}
            disabled={
              busy ||
              loading ||
              !available ||
              !accountUserId ||
              (!status && !hasPending) ||
              (!ready && !draftReady)
            }
            aria-label={`Add ${app.name}`}
            className="bg-aomi-fg text-aomi-bg flex h-9 w-full items-center justify-center rounded-lg text-[12px] font-medium disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : !available ? (
              "Unavailable on this network"
            ) : hasPending ? (
              "Save & add app"
            ) : ready || slots.every((slot) => !slot.required) ? (
              "Add app"
            ) : (
              "Enter required credentials"
            )}
          </button>
        )}
      </div>
    </DetailSection>
  );
}

function AppDetails({
  app,
  installed,
  installedReady,
  busy,
  activeChainId,
  accountUserId,
  onInstall,
  onUninstall,
}: {
  app: CatalogPackage;
  installed: boolean;
  installedReady: boolean;
  busy: boolean;
  activeChainId?: number;
  accountUserId?: string;
  onInstall: () => Promise<boolean>;
  onUninstall: () => void;
}) {
  const available = isPackageAvailableOnChain(app, activeChainId);
  return (
    <>
      <div className="px-5 pb-5 pt-1">
        <PackageIcon app={app} size="detail" />
        <div className="mt-4 flex items-center gap-2">
          <h2 className="text-[17px] font-semibold">{app.name}</h2>
          <span className="bg-aomi-surface-2 text-aomi-muted rounded-full px-2 py-1 text-[9px] font-medium uppercase tracking-[0.1em]">
            App
          </span>
        </div>
        <p className="text-aomi-muted mt-2 text-[13px] leading-5">
          {app.description}
        </p>
      </div>

      <div className="space-y-5 px-5">
        <DetailSection title="Availability">
          {app.chainIds.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px]">
              <Network className="text-aomi-muted size-3.5" />
              All supported networks
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {app.chainIds.map((chainId) => {
                const Icon = getChainIcon(chainId);
                return (
                  <span
                    key={chainId}
                    className="bg-aomi-surface-2 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px]"
                  >
                    {Icon ? <Icon className="size-3" /> : null}
                    {chainLabel(chainId)}
                  </span>
                );
              })}
            </div>
          )}
        </DetailSection>

        <DetailSection title="Category">
          <span className="bg-aomi-surface-2 rounded-full px-2.5 py-1.5 text-[11px]">
            {app.category}
          </span>
          {app.visibility === "personal" ? (
            <span className="bg-aomi-surface-2 ml-1.5 rounded-full px-2.5 py-1.5 text-[11px]">
              Personal
            </span>
          ) : null}
        </DetailSection>

        {app.secrets.length > 0 ||
        (accountUserId && app.applicationId != null) ? (
          <AppSecretSetup
            app={app}
            accountUserId={accountUserId}
            installed={installed}
            appBusy={busy}
            available={available}
            onInstall={onInstall}
          />
        ) : null}
      </div>

      <div className="mt-auto p-5">
        {app.pinned ? (
          <div className="bg-aomi-surface-2 text-aomi-muted flex h-10 items-center justify-center gap-2 rounded-xl text-[13px] font-medium">
            <Check size={14} /> Built in
          </div>
        ) : installed ? (
          <button
            type="button"
            onClick={onUninstall}
            disabled={!installedReady || busy}
            aria-label={`Remove ${app.name}`}
            className="border-aomi-border hover:bg-aomi-hover text-aomi-muted hover:text-aomi-danger flex h-10 w-full items-center justify-center rounded-xl border text-[13px] font-medium transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Remove app"}
          </button>
        ) : app.secrets.length > 0 ? null : (
          <button
            type="button"
            onClick={onInstall}
            disabled={!installedReady || busy || !available}
            aria-label={
              available
                ? `Add ${app.name}`
                : `Switch network to add ${app.name}`
            }
            className="bg-aomi-fg text-aomi-bg flex h-10 w-full items-center justify-center rounded-xl text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : available ? (
              "Add app"
            ) : (
              "Unavailable on this network"
            )}
          </button>
        )}
      </div>
    </>
  );
}

function SkillDetails({
  skill,
  onTry,
}: {
  skill: SkillSummary;
  onTry: () => void;
}) {
  const { json: request } = useShellTransport();
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    fetchSkillDetail(skill.id, request)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => {
        if (active) setError("Couldn’t load skill details.");
      });
    return () => {
      active = false;
    };
  }, [skill.id, request]);

  return (
    <>
      <div className="px-5 pb-5 pt-1">
        <SkillIdentity skillId={skill.id} size="detail" />
        <div className="mt-4 flex items-center gap-2">
          <h2 className="text-[17px] font-semibold">{skillLabel(skill)}</h2>
          <span className="bg-aomi-surface-2 text-aomi-muted rounded-full px-2 py-1 text-[9px] font-medium uppercase tracking-[0.1em]">
            Skill
          </span>
        </div>
        <p className="text-aomi-muted mt-2 text-[13px] leading-5">
          {skill.description}
        </p>
      </div>

      {error ? (
        <p className="text-aomi-danger px-5 text-[13px]">{error}</p>
      ) : !detail ? (
        <div className="text-aomi-muted flex items-center gap-2 px-5 text-[13px]">
          <Loader2 className="size-3.5 animate-spin" /> Loading details…
        </div>
      ) : (
        <div className="space-y-5 px-5">
          <DetailSection title="Works on">
            {detail.chainIds.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detail.chainIds.map((chainId) => {
                  const Icon = getChainIcon(chainId);
                  return (
                    <span
                      key={chainId}
                      className="bg-aomi-surface-2 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px]"
                    >
                      {Icon ? <Icon className="size-3" /> : null}
                      {chainLabel(chainId)}
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="text-aomi-muted text-[13px]">
                Any supported network
              </span>
            )}
          </DetailSection>

          {detail.tags.length > 0 ? (
            <DetailSection title="Good for">
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.slice(0, 8).map((tag) => (
                  <span
                    key={tag}
                    className="bg-aomi-surface-2 rounded-full px-2.5 py-1.5 text-[11px] capitalize"
                  >
                    {tag.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title="How it works">
            <div className="space-y-2 text-[13px]">
              <div className="flex items-center gap-2">
                <Sparkles className="text-aomi-accent size-3.5" />
                <span>
                  {detail.injectedTools.length + detail.toolNames.length} action
                  {detail.injectedTools.length + detail.toolNames.length === 1
                    ? ""
                    : "s"}{" "}
                  available
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench className="text-aomi-muted size-3.5" />
                <span className="text-aomi-muted">Activated when relevant</span>
              </div>
            </div>
          </DetailSection>
        </div>
      )}

      <div className="mt-auto p-5">
        <button
          type="button"
          onClick={onTry}
          className="bg-aomi-fg text-aomi-bg flex h-10 w-full items-center justify-center rounded-xl text-[13px] font-medium transition-opacity hover:opacity-90"
        >
          <MessageCircle size={14} className="mr-2" /> Try
        </button>
      </div>
    </>
  );
}

export function LibraryDetailPanel({
  selection,
  installed,
  installedReady,
  busy,
  activeChainId,
  accountUserId,
  onInstall,
  onUninstall,
  onTrySkill,
}: {
  selection: LibrarySelection | null;
  installed: boolean;
  installedReady: boolean;
  busy: boolean;
  activeChainId?: number;
  accountUserId?: string;
  onInstall: (app: CatalogPackage) => Promise<boolean>;
  onUninstall: (app: CatalogPackage) => void;
  onTrySkill: (skill: SkillSummary) => void;
}) {
  return (
    <aside
      aria-label={
        selection
          ? `${selection.kind === "app" ? selection.item.name : skillLabel(selection.item)} details`
          : "Capability details"
      }
      className="bg-aomi-raised border-aomi-border flex min-h-0 flex-1 flex-col md:border-l"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-5">
        {!selection ? (
          <div className="text-aomi-muted flex flex-1 items-center justify-center px-6 text-center text-[13px] leading-5">
            Select an app or skill to see its details.
          </div>
        ) : selection.kind === "app" ? (
          <AppDetails
            app={selection.item}
            installed={installed}
            installedReady={installedReady}
            busy={busy}
            activeChainId={activeChainId}
            accountUserId={accountUserId}
            onInstall={() => onInstall(selection.item)}
            onUninstall={() => onUninstall(selection.item)}
          />
        ) : (
          <SkillDetails
            skill={selection.item}
            onTry={() => onTrySkill(selection.item)}
          />
        )}
      </div>
    </aside>
  );
}
