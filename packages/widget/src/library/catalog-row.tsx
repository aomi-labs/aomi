"use client";
import { Check, Loader2, MessageCircle, Plus } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { aomiButton } from "@/ui/aomi/button";
import {
  ChainMarks,
  KindPill,
  SkillIdentity,
  type LibrarySelection,
} from "./library-detail-panel";
import { PackageIcon } from "./package-row";
import {
  ARC_TESTNET_CHAIN_ID,
  isPackageAvailableOnHost,
  type CatalogPackage,
} from "./packages-catalog";
import { selectionName, selectionDescription } from "./model";

// One width for Try, Add and Added so every row's action lines up.
const rowAction = cn(
  aomiButton({ variant: "secondary", size: "sm" }),
  "w-[72px]",
);

function AppAction({
  app,
  installed,
  busy,
  disabled,
  hostChainIds,
  onInstall,
}: {
  app: CatalogPackage;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  hostChainIds: readonly number[];
  onInstall: () => void;
}) {
  const available = isPackageAvailableOnHost(app, hostChainIds);
  if (installed) {
    return (
      <span className="text-aomi-muted type-meta inline-flex h-7 w-[72px] shrink-0 items-center justify-center gap-1.5 font-medium">
        <Check className="size-3.5" /> Added
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={disabled || !available}
      aria-label={
        available
          ? `Add ${app.name} from catalog`
          : `${app.name} needs a network this site doesn't support`
      }
      className={rowAction}
    >
      {busy ? (
        <Loader2 className="animate-spin" />
      ) : (
        <>
          <Plus /> Add
        </>
      )}
    </button>
  );
}

export function CatalogRow({
  selection,
  selected,
  installed,
  busy,
  disabled,
  hostChainIds,
  onSelect,
  onInstall,
  onTry,
}: {
  selection: LibrarySelection;
  selected: boolean;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  hostChainIds: readonly number[];
  onSelect: () => void;
  onInstall: () => void;
  onTry: () => void;
}) {
  const app = selection.kind === "app" ? selection.item : null;
  const arcOnly =
    app?.chainIds.length === 1 && app.chainIds[0] === ARC_TESTNET_CHAIN_ID;
  return (
    <article
      className={cn(
        "rounded-control flex min-h-14 items-center gap-3 px-2 transition-colors",
        selected ? "bg-aomi-surface-2" : "hover:bg-aomi-hover",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open ${selectionName(selection)} details`}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        {selection.kind === "app" ? (
          <PackageIcon app={selection.item} size="small" />
        ) : (
          <SkillIdentity skillId={selection.item.id} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span className="type-row [overflow-wrap:anywhere]">
              {selectionName(selection)}
            </span>
            <KindPill kind={selection.kind} />
            {arcOnly ? (
              <span className="type-meta text-aomi-muted shrink-0">
                Arc only
              </span>
            ) : null}
          </span>
          <span className="type-meta text-aomi-muted mt-0.5 line-clamp-2 block [overflow-wrap:anywhere]">
            {selectionDescription(selection)}
          </span>
        </span>
      </button>
      <span className="hidden w-24 shrink-0 justify-end md:flex">
        <ChainMarks chainIds={selection.item.chainIds} />
      </span>
      {app ? (
        <AppAction
          app={app}
          installed={installed}
          busy={busy}
          disabled={disabled}
          hostChainIds={hostChainIds}
          onInstall={onInstall}
        />
      ) : (
        <button
          type="button"
          onClick={onTry}
          aria-label={`Try ${selectionName(selection)}`}
          className={rowAction}
        >
          <MessageCircle /> Try
        </button>
      )}
    </article>
  );
}
