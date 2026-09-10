"use client";
import type { RefObject } from "react";
import { Search, X, type LucideIcon } from "lucide-react";
import { directoryModalType } from "../directory-modal-type";

export function SearchField({
  query,
  onQueryChange,
  searchRef,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="border-aomi-border bg-aomi-surface focus-within:border-aomi-muted flex h-10 min-w-0 items-center gap-2.5 rounded-xl border px-3.5">
      <Search className="text-aomi-muted size-4 shrink-0" />
      <input
        ref={searchRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label="Search library"
        placeholder="Search apps and skills"
        className="placeholder:text-aomi-muted min-w-0 flex-1 bg-transparent text-[14px] outline-none"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onQueryChange("")}
          className="text-aomi-muted hover:bg-aomi-hover flex size-5 items-center justify-center rounded-full"
        >
          <X className="size-3" />
        </button>
      ) : (
        <kbd className="border-aomi-border text-aomi-muted rounded-md border px-1.5 py-0.5 font-mono text-[9px]">
          /
        </kbd>
      )}
    </label>
  );
}

export function SidebarButton({
  label,
  icon: Icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 transition-colors ${directoryModalType.navigation} ${
        active
          ? "bg-aomi-surface-2 font-medium"
          : "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg"
      }`}
    >
      <Icon className="size-4" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined ? (
        <span className="font-mono text-[10px]">{count}</span>
      ) : null}
    </button>
  );
}

export function EmptyList() {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center text-center">
      <Search className="text-aomi-muted size-5" />
      <p className="mt-3 text-[13px] font-medium">No capabilities found</p>
      <p className="text-aomi-muted mt-1 text-xs">
        Try another search or section.
      </p>
    </div>
  );
}
