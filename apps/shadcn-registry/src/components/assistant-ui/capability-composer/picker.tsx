"use client";
import type { RefObject } from "react";
import { Globe2Icon } from "lucide-react";
import { getChainInfo } from "@aomi-labs/react";
import { getChainIcon } from "@/components/icons";
import type { CapabilityKind, PickerItem } from "./model";
import { usePickerPlacement } from "./use-picker-placement";

export function SupportedChainStack({ chainIds }: { chainIds?: number[] }) {
  const uniqueChainIds = [...new Set(chainIds ?? [])].filter(
    (chainId) => Number.isSafeInteger(chainId) && chainId > 0,
  );
  if (uniqueChainIds.length === 0) return null;

  const visibleChainIds = uniqueChainIds.slice(0, 3);
  const remaining = uniqueChainIds.length - visibleChainIds.length;
  const chainNames = uniqueChainIds.map(
    (chainId) => getChainInfo(chainId)?.name ?? `Chain ${chainId}`,
  );
  const label = `Supported on ${chainNames.join(", ")}`;

  return (
    <span
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center pl-1"
    >
      {visibleChainIds.map((chainId, index) => {
        const ChainIcon = getChainIcon(chainId) ?? Globe2Icon;
        return (
          <span
            key={chainId}
            className={`border-aomi-raised bg-aomi-surface-2 text-aomi-muted flex size-5 items-center justify-center rounded-full border ${index > 0 ? "-ml-1" : ""}`}
            style={{ zIndex: visibleChainIds.length - index }}
          >
            <ChainIcon className="size-3" />
          </span>
        );
      })}
      {remaining > 0 ? (
        <span className="bg-aomi-surface-2 text-aomi-muted -ml-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-medium">
          +{remaining}
        </span>
      ) : null}
    </span>
  );
}

export function CapabilityPicker({
  pickerId,
  pickerRef,
  visibleGroups,
  highlighted,
  onHighlight,
  onSelect,
}: {
  pickerId: string;
  pickerRef: RefObject<HTMLDivElement | null>;
  visibleGroups: { kind: CapabilityKind; label: string; items: PickerItem[] }[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onSelect: (item: PickerItem) => void;
}) {
  const { containerRef, above, height } = usePickerPlacement();
  const hasItems = visibleGroups.some((group) => group.items.length > 0);
  return (
    <div
      ref={containerRef}
      style={{ maxHeight: height }}
      className={`border-aomi-border bg-aomi-raised text-aomi-fg absolute left-0 z-50 flex w-full flex-col overflow-hidden rounded-2xl border p-2 shadow-[0_18px_50px_rgba(0,0,0,0.22)] ${above ? "bottom-full mb-8" : "top-full mt-2"}`}
    >
      {hasItems ? (
        <div
          id={pickerId}
          role="listbox"
          aria-label="Apps, skills, and chains"
          ref={pickerRef}
          className="aui-command-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-1"
        >
          {visibleGroups.map((group, groupIndex) => {
            const priorCount = visibleGroups
              .slice(0, groupIndex)
              .reduce((count, prior) => count + prior.items.length, 0);
            return (
              <section key={group.kind} aria-label={group.label}>
                <div className="text-aomi-muted px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.09em] first:pt-1.5">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item, itemIndex) => {
                    const index = priorCount + itemIndex;
                    return (
                      <button
                        key={item.key}
                        id={`${pickerId}-option-${index}`}
                        data-capability-index={index}
                        type="button"
                        role="option"
                        aria-selected={highlighted === index}
                        onMouseDown={(event) => event.preventDefault()}
                        onPointerMove={() => onHighlight(index)}
                        onClick={() => onSelect(item)}
                        className="hover:bg-aomi-surface-2 aria-selected:bg-aomi-surface-2 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors"
                      >
                        <span className="text-aomi-muted flex size-7 shrink-0 items-center justify-center">
                          <item.Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 py-px">
                          <span className="block truncate text-[13px] font-medium leading-4">
                            {item.label}
                          </span>
                          {item.description ? (
                            <span
                              title={item.fullDescription ?? item.description}
                              className="text-aomi-muted mt-px block truncate text-[11px] leading-4"
                            >
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                        <span className="ml-2 flex shrink-0 items-center gap-2">
                          {item.kind !== "chain" ? (
                            <SupportedChainStack chainIds={item.chainIds} />
                          ) : null}
                          <span className="bg-aomi-surface-2 text-aomi-muted min-w-12 rounded-full px-2 py-1 text-center text-[9px] font-medium uppercase tracking-[0.08em]">
                            {item.kind}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div
          id={pickerId}
          role="listbox"
          aria-label="Apps, skills, and chains"
          className="min-h-0 flex-1 py-1"
        >
          <div
            role="status"
            className="text-aomi-muted px-3 py-7 text-center text-xs"
          >
            No matching capabilities
          </div>
        </div>
      )}
      <div className="border-aomi-border/70 text-aomi-muted mt-1.5 flex min-h-8 shrink-0 items-center justify-between gap-3 border-t px-2.5 pb-0.5 pt-2 text-[11px]">
        <span className="truncate">
          Type to search apps, skills, and chains
        </span>
        <span
          aria-hidden="true"
          className="hidden shrink-0 items-center gap-2 text-[10px] sm:flex"
        >
          <span className="inline-flex items-center gap-1">
            <kbd className="font-sans">↑↓</kbd>
            navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="font-sans">↵</kbd>
            add
          </span>
        </span>
      </div>
    </div>
  );
}
