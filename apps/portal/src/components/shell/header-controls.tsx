"use client";

import { Moon, Package, Settings, Sun } from "lucide-react";
import { NetworkSelect } from "@aomi-labs/widget-lib";
import { useSettings } from "@portal/lib/use-settings";

/** Every header control stands 32px square so the row reads as one cluster. */
const headerButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-lg text-aomi-muted transition-colors hover:bg-aomi-hover hover:text-aomi-fg";

/**
 * Chat-header controls per the redesign: packages catalog, settings, and the
 * light/dark switch — settings and packages open as popups over the chat
 * instead of navigating away.
 */
export function HeaderControls({
  onOpenSettings,
  onOpenPackages,
  showSettings = true,
}: {
  onOpenSettings: () => void;
  onOpenPackages: () => void;
  showSettings?: boolean;
}) {
  const { settings, updateSetting } = useSettings();

  // Resolve "auto" against the applied class so the toggle flips what you see.
  const isDark =
    settings.colorMode === "dark" ||
    (settings.colorMode === "auto" &&
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"));

  return (
    <div className="flex items-center gap-2.5">
      {/* Per-thread network picker, styled as the header pill from the mock. */}
      <NetworkSelect className="border-aomi-border text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg h-8 rounded-full border px-2.5 text-[13px]" />
      <button
        type="button"
        onClick={onOpenPackages}
        className={headerButtonClass}
        aria-label="Browse packages"
      >
        <Package size={18} />
      </button>
      {showSettings ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className={headerButtonClass}
          aria-label="Open settings"
        >
          <Settings size={18} />
        </button>
      ) : null}
      <ThemeSwitch
        dark={isDark}
        onToggle={() => updateSetting("colorMode", isDark ? "light" : "dark")}
      />
    </div>
  );
}

/** Sliding switch — the knob carries the icon of the theme currently in use. */
function ThemeSwitch({
  dark,
  onToggle,
}: {
  dark: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      onClick={onToggle}
      // Track stands 32px tall so the switch matches the icon buttons beside it.
      className="border-aomi-border bg-aomi-surface-2 hover:border-aomi-muted relative h-8 w-14 flex-shrink-0 rounded-full border transition-colors"
    >
      <span
        // Inline offset: a two-position slide is clearer as data than as two
        // arbitrary utility classes (which Tailwind doesn't reliably emit here).
        style={{ translate: dark ? "27px -50%" : "3px -50%" }}
        className="bg-aomi-fg text-aomi-bg absolute left-0 top-1/2 flex h-[26px] w-[26px] items-center justify-center rounded-full transition-transform duration-200"
      >
        {dark ? <Moon size={15} /> : <Sun size={15} />}
      </span>
    </button>
  );
}
