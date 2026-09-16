"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CircleArrowUp,
  ExternalLink,
  KeyRound,
  MessageSquare,
  Rocket,
} from "lucide-react";
import { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";
import {
  buildQueryKeys,
  buildQueryStaleTime,
} from "@build/features/launch/query-keys";
import { operateFetch } from "@build/features/operate/client";
import {
  caipChainLabel,
  creditsToUsd,
  plural,
  truncateAddress,
  usdLabel,
} from "@build/features/operate/format";
import { chatAppUrl } from "@build/lib/chat-url";
import { BUILD_GLOSSARY } from "@build/lib/glossary";
import { environmentCard } from "./environment-card";
import { projectDeploymentStatus } from "../project-deployment-status";
import { sdkCompatibility, sourceSdkVersion } from "../sdk-compatibility";
import {
  formatCompactCount,
  summarizeProjectUsage,
  type UsagePeek,
} from "../usage-peek";
import { EmptyPanel } from "../ui/state-panels";

type Detail = ReturnType<typeof useProjectDetail>;

function UsageSpark({ spark }: { spark: number[] }) {
  if (spark.length === 0) return null;
  return (
    <div
      className="mt-3 flex h-6 items-end gap-0.5"
      aria-hidden
      title="Credits by day"
    >
      {spark.map((value, index) => (
        <span
          key={index}
          className="bg-foreground/25 w-1.5 rounded-sm"
          style={{ height: `${Math.max(12, Math.round(value * 100))}%` }}
        />
      ))}
    </div>
  );
}

function StatusCard({
  label,
  value,
  hint,
  actionHref,
  actionLabel,
  tone = "neutral",
  meter,
}: {
  label: string;
  value: string;
  hint: string;
  actionHref?: string;
  actionLabel?: string;
  tone?: "good" | "warn" | "neutral";
  meter?: ReactNode;
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-border bg-surface-2";

  return (
    <div className={`rounded-md border px-3 py-3 ${toneClass}`}>
      <div className="text-dim text-[11px] uppercase tracking-wide">
        {label}
      </div>
      <div className="text-foreground mt-1.5 text-sm font-medium">{value}</div>
      <p className="text-dim mt-1 text-xs leading-5">{hint}</p>
      {meter}
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="text-foreground mt-3 inline-flex text-xs font-medium underline underline-offset-2 hover:opacity-80"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function usageCardCopy(usage: UsagePeek | null): {
  value: string;
  hint: string;
  tone: "good" | "warn" | "neutral";
} {
  if (usage == null) {
    return {
      value: "Loading…",
      hint: "Credits for this project.",
      tone: "neutral",
    };
  }
  if (!usage.available) {
    return {
      value: "Unavailable",
      hint: "Could not load usage. Open Usage to retry. Not Billing.",
      tone: "warn",
    };
  }
  if (usage.creditsUsed <= 0 && usage.tokens <= 0) {
    return {
      value: "No traffic yet",
      hint: "Credits appear after chat turns. Meter only — not Billing.",
      tone: "neutral",
    };
  }
  const dayHint =
    usage.dayCount === 1
      ? "1 day with traffic"
      : `${usage.dayCount} days with traffic`;
  return {
    value: `${usage.creditsUsed.toFixed(2)} credits`,
    hint: `${formatCompactCount(usage.tokens)} tokens · ${dayHint}. Not Billing.`,
    tone: "good",
  };
}

function monetizationCard(source: NonNullable<Detail["source"]>) {
  const configured = source.apps.flatMap((app) =>
    Object.entries(app.pricing?.config.resources ?? {}).map(
      ([tool, resource]) => {
        const beneficiary = app.pricing?.config.beneficiaries.find(
          (candidate) => candidate.name === resource.beneficiary,
        );
        return {
          app: app.name,
          tool,
          credits: resource.pricing.flat,
          beneficiary,
        };
      },
    ),
  );
  if (!configured.length) return null;
  const first = configured[0];
  const route = first.beneficiary
    ? `${caipChainLabel(first.beneficiary.chain)} · ${truncateAddress(first.beneficiary.value)}`
    : "Aomi-managed beneficiary";
  return {
    value: plural(configured.length, "priced tool"),
    hint: `${first.app}/${first.tool} · ${first.credits.toFixed(2)} credits (${usdLabel(creditsToUsd(first.credits))}) per successful call · ${route}`,
    tone: "good" as const,
  };
}

function operateUsageHref(projectId: number, anchor?: string) {
  const params = new URLSearchParams({ project: String(projectId) });
  return `/operate/usage?${params}${anchor ? `#${anchor}` : ""}`;
}

export function HomeTab({
  detail,
  tabHref,
}: {
  detail: Detail;
  tabHref?: (
    tab: "home" | "deployments" | "providers" | "environment" | "chat",
  ) => string;
}) {
  const source = detail.source;
  const { loadRequiredSecrets, loadSecrets } = detail;
  // Same key as the operate usage page and the project-detail prefetch, so a
  // hover or page-mount warm-up serves this card from cache.
  const usageQuery = useQuery({
    queryKey: buildQueryKeys.operate(
      detail.accountKey ?? "unavailable",
      "usage",
      source?.id ?? null,
    ),
    queryFn: () =>
      operateFetch<{
        daily?: Array<Record<string, unknown>>;
      }>("usage", { projectId: source?.id }),
    enabled: source !== null,
    staleTime: buildQueryStaleTime.operate,
  });
  const usage: UsagePeek | null = useMemo(
    () =>
      usageQuery.data !== undefined
        ? summarizeProjectUsage(usageQuery.data)
        : usageQuery.isError
          ? summarizeProjectUsage(null)
          : null,
    [usageQuery.data, usageQuery.isError],
  );

  useEffect(() => {
    for (const app of source?.apps ?? []) loadSecrets(app.id);
    // The card reports the same gate the deploy enforces, so it needs the
    // declared requirements — not just which keys happen to be set.
    loadRequiredSecrets?.();
  }, [loadRequiredSecrets, loadSecrets, source?.apps]);

  const status = useMemo(
    () => (source ? projectDeploymentStatus(source) : null),
    [source],
  );
  const lifecycle = status?.lifecycle ?? null;
  const requiredSdk = detail.sdk?.sdkStatus.requiredVersion ?? null;
  const outdated =
    sdkCompatibility(source ? sourceSdkVersion(source) : null, requiredSdk) ===
    "outdated";

  // Gate on the union of the source's apps and any the required-secrets check
  // itself named — a re-synced repo can register an app this snapshot predates.
  const gateApps = useMemo(() => {
    const names = source?.apps.map((app) => app.name) ?? [];
    const known = new Set(names);
    for (const name of Object.keys(detail.requiredSecrets ?? {})) {
      if (!known.has(name)) names.push(name);
    }
    return names;
  }, [source, detail.requiredSecrets]);

  const environment = useMemo(
    () =>
      environmentCard({
        apps: gateApps,
        requiredSecrets: detail.requiredSecrets ?? null,
        requiredSecretsError: detail.requiredSecretsError ?? null,
        secretsByApp: detail.secretsByApp,
        secretsError: detail.secretsError,
      }),
    [
      gateApps,
      detail.requiredSecrets,
      detail.requiredSecretsError,
      detail.secretsByApp,
      detail.secretsError,
    ],
  );

  if (!source || !lifecycle) {
    return <EmptyPanel>Project not found.</EmptyPanel>;
  }

  const hrefForTab = (
    tab: "home" | "deployments" | "providers" | "environment" | "chat",
  ) => tabHref?.(tab) ?? `?tab=${tab}`;

  const isLive =
    lifecycle.kind === "live" && Boolean(lifecycle.chatApp) && !outdated;
  const chatUrl = isLive
    ? chatAppUrl(lifecycle.chatApp!, {
        locked: true,
        applicationId: lifecycle.chatApplicationId,
      })
    : null;

  const liveValue = outdated
    ? "Outdated"
    : lifecycle.kind === "live"
      ? "Live"
      : lifecycle.kind === "building" || lifecycle.kind === "build_ready"
        ? lifecycle.statusLabel
        : lifecycle.kind === "failed"
          ? lifecycle.statusLabel
          : "Not live";

  const liveTone = outdated
    ? "warn"
    : lifecycle.kind === "live"
      ? "good"
      : lifecycle.kind === "failed"
        ? "warn"
        : "warn";

  const usageCopy = usageCardCopy(usage);
  const monetization = monetizationCard(source);

  const nextAction =
    outdated && requiredSdk
      ? {
          href: hrefForTab("deployments"),
          label: `Upgrade to ${requiredSdk}`,
          copy: "Update the linked repository before opening chat.",
        }
      : !isLive
        ? {
            href: hrefForTab("deployments"),
            label: "Redeploy from Linked Repository",
            copy: "Publish a deployment, then set keys and open chat.",
          }
        : environment.blocked
          ? {
              href: hrefForTab("environment"),
              label: "Open Environment",
              copy: environment.hint,
            }
          : chatUrl
            ? {
                href: chatUrl,
                label: "Open Chat",
                copy: "App is live and keys look set. Try it in chat.",
                external: true,
              }
            : {
                href: hrefForTab("chat"),
                label: "Open Chat tab",
                copy: "Continue in the Chat tab.",
              };

  return (
    <div className="divide-border divide-y">
      <div className="px-4 py-4">
        <div className="text-foreground text-sm font-medium">Project home</div>
        <p className="text-dim mt-1 max-w-2xl text-xs leading-5">
          {BUILD_GLOSSARY.project.meaning} Check live status, environment keys,
          and open chat from here.
        </p>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <StatusCard
          label="Live"
          value={liveValue}
          hint={
            outdated && requiredSdk
              ? `This deployment must be rebuilt with aomi-sdk ${requiredSdk}.`
              : isLive
                ? `${lifecycle.chatApp} is active.`
                : lifecycle.message || "Deploy and activate an app to go live."
          }
          tone={liveTone}
          actionHref={hrefForTab("deployments")}
          actionLabel="View deployments"
        />
        <StatusCard
          label="Environment"
          value={environment.value}
          hint={environment.hint}
          tone={environment.tone}
          actionHref={hrefForTab("environment")}
          actionLabel="Open Environment"
        />
        <StatusCard
          label="Chat"
          value={isLive ? "Ready" : "Needs live app"}
          hint={
            isLive
              ? "Open the chat session for this app."
              : "Chat unlocks after a live deployment."
          }
          tone={isLive ? "good" : "neutral"}
          actionHref={isLive ? hrefForTab("chat") : hrefForTab("deployments")}
          actionLabel={isLive ? "Chat tab" : "Go to deployments"}
        />
        <StatusCard
          label="Usage"
          value={usageCopy.value}
          hint={usageCopy.hint}
          tone={usageCopy.tone}
          meter={
            usage?.available && usage.spark.length > 0 ? (
              <UsageSpark spark={usage.spark} />
            ) : null
          }
          actionHref={operateUsageHref(source.id)}
          actionLabel="Open Usage"
        />
        {monetization ? (
          <StatusCard
            label="Monetization"
            value={monetization.value}
            hint={monetization.hint}
            tone={monetization.tone}
            actionHref={operateUsageHref(source.id, "partner-payments")}
            actionLabel="View partner ledger"
          />
        ) : null}
      </div>

      <div className="border-border bg-surface-2/40 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-foreground text-sm font-medium">Next</div>
            <p className="text-dim mt-1 text-xs leading-5">{nextAction.copy}</p>
          </div>
          {"external" in nextAction && nextAction.external ? (
            <a
              href={nextAction.href}
              target="_blank"
              rel="noreferrer"
              className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium hover:opacity-90"
            >
              <MessageSquare className="size-3.5" aria-hidden />
              {nextAction.label}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : (
            <Link
              href={nextAction.href}
              className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium hover:opacity-90"
            >
              {nextAction.label.startsWith("Upgrade to ") ? (
                <CircleArrowUp className="size-3.5" aria-hidden />
              ) : nextAction.label === "Redeploy from Linked Repository" ? (
                <Rocket className="size-3.5" aria-hidden />
              ) : nextAction.label === "Open Environment" ? (
                <KeyRound className="size-3.5" aria-hidden />
              ) : (
                <MessageSquare className="size-3.5" aria-hidden />
              )}
              {nextAction.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
