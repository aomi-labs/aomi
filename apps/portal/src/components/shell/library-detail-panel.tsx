"use client";

import { createElement, useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Loader2,
  MessageCircle,
  Network,
  Sparkles,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { getChainIcon, getSkillIcon } from "@/components/icons";
import {
  fetchSkillDetail,
  skillLabel,
  type SkillDetail,
  type SkillSummary,
} from "@/lib/capabilities/skill-catalog";
import { PackageIcon } from "./package-row";
import {
  isPackageAvailableOnChain,
  type CatalogPackage,
} from "./packages-catalog";

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

function AppDetails({
  app,
  installed,
  installedReady,
  busy,
  activeChainId,
  onInstall,
  onUninstall,
}: {
  app: CatalogPackage;
  installed: boolean;
  installedReady: boolean;
  busy: boolean;
  activeChainId?: number;
  onInstall: () => void;
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
        ) : (
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
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    fetchSkillDetail(skill.id)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => {
        if (active) setError("Couldn’t load skill details.");
      });
    return () => {
      active = false;
    };
  }, [skill.id]);

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
  onInstall,
  onUninstall,
  onTrySkill,
}: {
  selection: LibrarySelection | null;
  installed: boolean;
  installedReady: boolean;
  busy: boolean;
  activeChainId?: number;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onTrySkill: (skill: SkillSummary) => void;
}) {
  return (
    <aside
      aria-label={
        selection
          ? `${selection.kind === "app" ? selection.item.name : skillLabel(selection.item)} details`
          : "Capability details"
      }
      className="bg-aomi-raised border-aomi-border flex min-h-0 flex-col border-l"
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
            onInstall={() => onInstall(selection.item.id)}
            onUninstall={() => onUninstall(selection.item.id)}
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
