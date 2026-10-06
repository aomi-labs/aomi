"use client";
import { useShellTransport } from "@/account/transport";

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
import { LoadingLine, LoadingPane } from "@/ui/aomi/loading-pane";
import { cn } from "@aomi-labs/react";
import { getChainIcon } from "@/icons/chain-map";
import { getSkillIcon } from "@/icons/skills/skill-icons";
import { AomiButton } from "@/ui/aomi/button";
import { StatusPill } from "@/ui/aomi/status-pill";
import {
  appSecretsReady,
  useAppSecretsState,
} from "@/account/app-secrets/use-app-secrets-state";
import {
  fetchSkillDetail,
  skillLabel,
  type SkillDetail,
  type SkillSummary,
} from "@/composer/capabilities/skill-catalog";
import { PackageIcon } from "./package-row";
import {
  isPackageAvailableOnHost,
  type CatalogPackage,
} from "./packages-catalog";
import {
  fetchAppSecrets,
  removeAppSecret,
  saveAppSecrets,
} from "@/account/shell/packages-api";

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

/** App or Skill, the same pill in the catalog row and the inspector. */
export function KindPill({ kind }: { kind: LibrarySelection["kind"] }) {
  return (
    <StatusPill tone={kind === "skill" ? "accent" : "neutral"}>
      {kind === "skill" ? "Skill" : "App"}
    </StatusPill>
  );
}

/** A descriptive chip in the inspector: a network, category or use. */
function DetailPill({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "bg-aomi-surface-2 type-meta inline-flex h-6 items-center gap-1.5 rounded-full px-2.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ChainPills({ chainIds }: { chainIds: number[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chainIds.map((chainId) => {
        const Icon = getChainIcon(chainId);
        return (
          <DetailPill key={chainId}>
            {Icon ? <Icon className="size-3" /> : null}
            {chainLabel(chainId)}
          </DetailPill>
        );
      })}
    </div>
  );
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
      <span className="type-meta text-aomi-muted whitespace-nowrap">
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
        <span className="type-meta text-aomi-muted ml-1">
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
      <h3 className="type-eyebrow text-aomi-muted">{title}</h3>
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
            <p className="type-meta">
              Use your own credentials for this app. Saved values are never
              shown again.
            </p>
            {accountUserId ? (
              <p className="type-meta text-aomi-muted mt-0.5">
                {loading ? (
                  <LoadingLine className="w-20" />
                ) : ready ? (
                  "Ready to use"
                ) : (
                  "Setup required"
                )}
              </p>
            ) : (
              <p className="type-meta text-aomi-danger mt-0.5">
                Sign in to save credentials and add this app.
              </p>
            )}
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta flex items-center justify-between gap-2 px-2.5 py-2"
          >
            <span>{error}</span>
            {accountUserId && status === null ? (
              <AomiButton
                variant="ghost"
                size="sm"
                onClick={() => void secretState.retry()}
                disabled={loading}
                className="text-aomi-fg -my-1"
              >
                Retry
              </AomiButton>
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
                  className="type-address min-w-0 truncate font-medium"
                >
                  {slot.name}
                </label>
                <span className="type-meta text-aomi-muted shrink-0">
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
                <p className="type-meta text-aomi-muted">{slot.description}</p>
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
                    className="border-aomi-border bg-aomi-bg placeholder:text-aomi-muted rounded-control type-control h-8 min-w-0 flex-1 border px-2.5 outline-none focus:border-current disabled:opacity-50"
                  />
                ) : (
                  <p className="type-meta text-aomi-muted min-w-0 flex-1 py-2">
                    This saved credential can only be removed.
                  </p>
                )}
                {slot.configured ? (
                  <AomiButton
                    variant="danger"
                    size="icon"
                    aria-label={`Remove ${slot.name}`}
                    title={`Remove ${slot.name}`}
                    disabled={busy}
                    onClick={() => void secretState.remove(slot.name)}
                  >
                    {busyName === slot.name ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </AomiButton>
                ) : null}
              </div>
            </div>
          );
        })}

        {installed ? (
          <AomiButton
            variant="primary"
            onClick={() => void secretState.save()}
            disabled={busy || !hasPending}
            className="w-full"
          >
            {busyName === "save" ? (
              <Loader2 className="animate-spin" />
            ) : (
              "Save changes"
            )}
          </AomiButton>
        ) : (
          <AomiButton
            variant="primary"
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
            className="w-full"
          >
            {busy ? (
              <Loader2 className="animate-spin" />
            ) : !available ? (
              "Network not supported"
            ) : hasPending ? (
              "Save & add app"
            ) : ready || slots.every((slot) => !slot.required) ? (
              "Add app"
            ) : (
              "Enter required credentials"
            )}
          </AomiButton>
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
  hostChainIds,
  accountUserId,
  onInstall,
  onUninstall,
}: {
  app: CatalogPackage;
  installed: boolean;
  installedReady: boolean;
  busy: boolean;
  hostChainIds: readonly number[];
  accountUserId?: string;
  onInstall: () => Promise<boolean>;
  onUninstall: () => void;
}) {
  const available = isPackageAvailableOnHost(app, hostChainIds);
  return (
    <>
      <div className="px-5 pb-5 pt-1">
        <PackageIcon app={app} size="detail" />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <h2 className="type-title">{app.name}</h2>
          <KindPill kind="app" />
          {app.visibility === "personal" ? (
            <StatusPill tone="accent">Personal</StatusPill>
          ) : null}
        </div>
        <p className="type-control text-aomi-muted mt-2">{app.description}</p>
      </div>

      <div className="space-y-5 px-5">
        <DetailSection title="Availability">
          {app.chainIds.length === 0 ? (
            <div className="type-control flex items-center gap-2">
              <Network className="text-aomi-muted size-3.5" />
              All supported networks
            </div>
          ) : (
            <ChainPills chainIds={app.chainIds} />
          )}
        </DetailSection>

        <DetailSection title="Category">
          <DetailPill>{app.category}</DetailPill>
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
          <div className="bg-aomi-surface-2 text-aomi-muted rounded-control type-control flex h-8 items-center justify-center gap-1.5 font-medium">
            <Check className="size-3.5" /> Built in
          </div>
        ) : installed ? (
          <AomiButton
            variant="danger"
            onClick={onUninstall}
            disabled={!installedReady || busy}
            aria-label={`Remove ${app.name}`}
            className="w-full"
          >
            {busy ? <Loader2 className="animate-spin" /> : "Remove app"}
          </AomiButton>
        ) : app.secrets.length > 0 ? null : (
          <AomiButton
            variant="primary"
            onClick={onInstall}
            disabled={!installedReady || busy || !available}
            aria-label={
              available
                ? `Add ${app.name}`
                : `${app.name} needs a network this site doesn't support`
            }
            className="w-full"
          >
            {busy ? (
              <Loader2 className="animate-spin" />
            ) : available ? (
              "Add app"
            ) : (
              "Network not supported"
            )}
          </AomiButton>
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
          <h2 className="type-title">{skillLabel(skill)}</h2>
          <KindPill kind="skill" />
        </div>
        <p className="type-control text-aomi-muted mt-2">{skill.description}</p>
      </div>

      {error ? (
        <p className="type-control text-aomi-danger px-5">{error}</p>
      ) : !detail ? (
        <LoadingPane label="Loading details" />
      ) : (
        <div className="space-y-5 px-5">
          <DetailSection title="Works on">
            {detail.chainIds.length > 0 ? (
              <ChainPills chainIds={detail.chainIds} />
            ) : (
              <span className="type-control text-aomi-muted">
                Any supported network
              </span>
            )}
          </DetailSection>

          {detail.tags.length > 0 ? (
            <DetailSection title="Good for">
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.slice(0, 8).map((tag) => (
                  <DetailPill key={tag} className="capitalize">
                    {tag.replaceAll("_", " ")}
                  </DetailPill>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title="How it works">
            <div className="type-control space-y-2">
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
        <AomiButton variant="primary" onClick={onTry} className="w-full">
          <MessageCircle /> Try
        </AomiButton>
      </div>
    </>
  );
}

export function LibraryDetailPanel({
  selection,
  loading = false,
  installed,
  installedReady,
  busy,
  hostChainIds,
  accountUserId,
  onInstall,
  onUninstall,
  onTrySkill,
}: {
  selection: LibrarySelection | null;
  /** The library is still loading: keep the panel empty. */
  loading?: boolean;
  installed: boolean;
  installedReady: boolean;
  busy: boolean;
  hostChainIds: readonly number[];
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
          loading ? null : (
            <div className="type-control text-aomi-muted flex flex-1 items-center justify-center px-6 text-center">
              Select an app or skill to see its details.
            </div>
          )
        ) : selection.kind === "app" ? (
          <AppDetails
            app={selection.item}
            installed={installed}
            installedReady={installedReady}
            busy={busy}
            hostChainIds={hostChainIds}
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
