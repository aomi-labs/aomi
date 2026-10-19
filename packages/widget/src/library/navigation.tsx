"use client";
import type { RefObject } from "react";
import { AomiButton } from "@/ui/aomi/button";
import { Search, X, Plus } from "lucide-react";

export function SearchField({
  query,
  onQueryChange,
  searchRef,
  onAddPrivateApp,
}: {
  onAddPrivateApp: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="border-aomi-border bg-aomi-surface focus-within:border-aomi-muted rounded-control flex h-10 min-w-0 flex-1 items-center gap-2.5 border px-3.5">
        <Search className="text-aomi-muted size-4 shrink-0" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="Search library"
          placeholder="Search apps and skills"
          className="placeholder:text-aomi-muted min-w-0 flex-1 bg-transparent text-base outline-none md:text-[14px]"
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
      <AomiButton
        onClick={onAddPrivateApp}
        className="h-10"
        aria-label="Add private app"
        title="Add private app"
      >
        <Plus className="size-4" />
        <span>App</span>
      </AomiButton>
    </div>
  );
}

export function EmptyList() {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center text-center">
      <Search className="text-aomi-muted size-5" />
      <p className="type-section mt-3">No capabilities found</p>
      <p className="type-meta text-aomi-muted mt-1">
        Try another search or section.
      </p>
    </div>
  );
}
