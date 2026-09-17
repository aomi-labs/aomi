"use client";
import { Check, Loader2, MessageCircle, Plus } from "lucide-react";
import {
  ChainMarks,
  SkillIdentity,
  type LibrarySelection,
} from "../library-detail-panel";
import { PackageIcon } from "../package-row";
import {
  ARC_TESTNET_CHAIN_ID,
  isPackageAvailableOnChain,
  type CatalogPackage,
} from "../packages-catalog";
import { selectionName, selectionDescription } from "./model";

function KindLabel({ kind }: { kind: LibrarySelection["kind"] }) {
  return (
    <span className="bg-aomi-surface-2 text-aomi-muted rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]">
      {kind}
    </span>
  );
}

function AppAction({
  app,
  installed,
  busy,
  disabled,
  activeChainId,
  onInstall,
}: {
  app: CatalogPackage;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  activeChainId?: number;
  onInstall: () => void;
}) {
  const available = isPackageAvailableOnChain(app, activeChainId);
  if (installed) {
    return (
      <span className="text-aomi-muted flex h-8 w-[62px] shrink-0 items-center justify-center gap-1.5 text-[12px] font-medium">
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
        available ? `Add ${app.name}` : `Switch network to add ${app.name}`
      }
      className="border-aomi-border hover:bg-aomi-hover flex h-8 w-[62px] shrink-0 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-medium transition-colors disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <>
          <Plus className="size-3.5" /> Add
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
  activeChainId,
  onSelect,
  onInstall,
  onTry,
}: {
  selection: LibrarySelection;
  selected: boolean;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  activeChainId?: number;
  onSelect: () => void;
  onInstall: () => void;
  onTry: () => void;
}) {
  const app = selection.kind === "app" ? selection.item : null;
  const arcOnly =
    app?.chainIds.length === 1 && app.chainIds[0] === ARC_TESTNET_CHAIN_ID;
  return (
    <article
      className={`flex min-h-[58px] items-center gap-2 rounded-xl px-2 transition-colors ${selected ? "bg-aomi-surface-2" : "hover:bg-aomi-hover"}`}
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
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold">
              {selectionName(selection)}
            </span>
            <KindLabel kind={selection.kind} />
            {arcOnly ? (
              <span className="text-aomi-muted shrink-0 text-[10px]">
                Arc only
              </span>
            ) : null}
          </span>
          <span className="text-aomi-muted mt-0.5 block truncate text-[12px]">
            {selectionDescription(selection)}
          </span>
        </span>
      </button>
      <ChainMarks chainIds={selection.item.chainIds} />
      {app ? (
        <AppAction
          app={app}
          installed={installed}
          busy={busy}
          disabled={disabled}
          activeChainId={activeChainId}
          onInstall={onInstall}
        />
      ) : (
        <button
          type="button"
          onClick={onTry}
          aria-label={`Try ${selectionName(selection)}`}
          className="border-aomi-border hover:bg-aomi-hover flex h-8 w-[62px] shrink-0 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-medium transition-colors"
        >
          <MessageCircle className="size-3.5" /> Try
        </button>
      )}
    </article>
  );
}
