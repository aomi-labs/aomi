"use client";

import { Check, Loader2 } from "lucide-react";
import { AppIdentityIcon } from "@/components/icons/app-identity-icon";
import type { CatalogPackage } from "./packages-catalog";
import {
  ARC_TESTNET_CHAIN_ID,
  isPackageAvailableOnChain,
} from "./packages-catalog";

interface PackageRowProps {
  app: CatalogPackage;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  activeChainId?: number;
  onInstall: () => void;
  onUninstall: () => void;
}

export function PackageRow({
  app,
  installed,
  busy,
  disabled,
  activeChainId,
  onInstall,
  onUninstall,
}: PackageRowProps) {
  const chainAvailable = isPackageAvailableOnChain(app, activeChainId);
  const arcOnly =
    app.chainIds.length === 1 && app.chainIds[0] === ARC_TESTNET_CHAIN_ID;

  return (
    <article className="border-aomi-border group flex min-h-[72px] items-center gap-3 border-b py-3">
      <PackageIcon app={app} />
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
          <span className="truncate">{app.name}</span>
          {arcOnly ? (
            <span className="border-aomi-border text-aomi-muted shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
              Arc only
            </span>
          ) : null}
        </h3>
        <p className="text-aomi-muted mt-0.5 truncate text-xs">
          {app.description}
        </p>
      </div>
      {app.pinned ? (
        // Core apps can't be removed — state the fact without offering the
        // reversal, so the button never lies about what a click would do.
        <span className="text-aomi-muted flex w-[82px] flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 py-2 text-[13px] font-medium">
          <Check size={14} />
          Built in
        </span>
      ) : installed ? (
        // Bordered at rest so it reads as actionable without hover; the label
        // states the fact, hover reveals the reversal.
        <button
          type="button"
          onClick={onUninstall}
          disabled={disabled}
          title={`Remove ${app.name}`}
          aria-label={`Remove ${app.name}`}
          className="border-aomi-border text-aomi-muted hover:bg-aomi-hover hover:text-aomi-danger flex w-[82px] flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <>
              <Check size={14} className="group-hover:hidden" />
              <span className="group-hover:hidden">Installed</span>
              <span className="hidden group-hover:inline">Remove</span>
            </>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          disabled={disabled || !chainAvailable}
          title={
            chainAvailable
              ? `Install ${app.name}`
              : `Switch to Arc Testnet to install ${app.name}`
          }
          aria-label={
            chainAvailable
              ? `Install ${app.name}`
              : `Switch to Arc Testnet to install ${app.name}`
          }
          className="border-aomi-border hover:bg-aomi-hover flex w-[82px] flex-shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : "Install"}
        </button>
      )}
    </article>
  );
}

interface PackageIconProps {
  app: CatalogPackage;
  size?: "small" | "large" | "detail";
}

export function PackageIcon({ app, size = "large" }: PackageIconProps) {
  return (
    <AppIdentityIcon
      brandId={app.brandId}
      name={app.name}
      abbr={app.abbr}
      size={size === "detail" ? "detail" : "row"}
    />
  );
}
