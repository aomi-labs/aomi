"use client";

import { LibraryBig, ListTree, Moon, Settings, Sun } from "lucide-react";
import { NetworkSelect, useActivityPanel } from "@aomi-labs/widget-lib";
import { Button } from "@/components/ui/button";
import { useSettings } from "@portal/lib/use-settings";

/** Every header control stands 32px square so the row reads as one cluster. */
const headerButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-lg text-aomi-muted transition-colors hover:bg-aomi-hover hover:text-aomi-fg";

/**
 * Chat-header controls per the redesign: capability library, settings, and the
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
  const activity = useActivityPanel();

  // Resolve "auto" against the applied class so the toggle flips what you see.
  const isDark =
    settings.colorMode === "dark" ||
    (settings.colorMode === "auto" &&
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"));

  return (
    <div className="flex items-center gap-2.5">
      <NetworkSelect className="border-aomi-border text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg h-8 rounded-full border px-2.5 text-[13px]" />
      <button
        type="button"
        onClick={onOpenPackages}
        className={headerButtonClass}
        aria-label="Open capability library"
      >
        <LibraryBig size={18} />
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
      <button
        type="button"
        disabled={!activity.worthShowing}
        onClick={() => activity.setOpen(!activity.open)}
        className={`${headerButtonClass} disabled:hover:text-aomi-muted disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent ${
          activity.open ? "bg-aomi-surface-2 text-aomi-fg" : ""
        }`}
        aria-label={
          !activity.worthShowing
            ? "Chat activity unavailable"
            : activity.open
              ? "Hide chat activity"
              : activity.reviewing
                ? "Review transactions"
                : "Show chat activity"
        }
        aria-pressed={activity.worthShowing ? activity.open : false}
      >
        <ListTree size={18} />
      </button>
    </div>
  );
}

/** Theme uses the same quiet, compact icon control as the rest of the header. */
function ThemeSwitch({
  dark,
  onToggle,
}: {
  dark: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={`Switch to ${dark ? "light" : "dark"} theme`}
      onClick={onToggle}
      className="text-aomi-muted hover:text-aomi-fg"
    >
      {dark ? <Moon size={16} /> : <Sun size={16} />}
    </Button>
  );
}
