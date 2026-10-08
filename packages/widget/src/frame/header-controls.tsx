"use client";

import type { ReactNode } from "react";
import { LibraryBig, ListTree, Moon, Settings, Sun } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { NetworkSelect } from "@/controls/network-select";
import { useActivityPanel } from "@/sidebar/activity/activity-panel-context";
import { useShellTransport } from "@/account/transport";
import { useSettings } from "@/account/use-settings";

/** Every header control stands 32px square so the row reads as one cluster. */
const headerButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-[10px] text-aomi-muted transition-colors hover:bg-aomi-hover hover:text-aomi-fg";

/** Names each icon on hover; the span keeps the tip working on a disabled button. */
function HeaderTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Chat-header controls per the redesign: capability library, settings, and the
 * light/dark switch — settings and packages open as popups over the chat
 * instead of navigating away.
 */
export function HeaderControls({
  onOpenSettings,
  onOpenPackages,
  showSettings = true,
  showLibrary = true,
  showTheme = true,
  showActivity = true,
  showNetwork = true,
}: {
  onOpenSettings: () => void;
  onOpenPackages: () => void;
  showSettings?: boolean;
  showLibrary?: boolean;
  showTheme?: boolean;
  showActivity?: boolean;
  showNetwork?: boolean;
}) {
  const { settings, updateSetting } = useSettings();
  const { themeRoot } = useShellTransport();
  const activity = useActivityPanel();

  // Resolve "auto" against the applied class so the toggle flips what you see.
  const isDark =
    settings.colorMode === "dark" ||
    (settings.colorMode === "auto" &&
      typeof document !== "undefined" &&
      (themeRoot ?? document.documentElement).classList.contains("dark"));

  return (
    <div className="flex items-center gap-2.5">
      {showNetwork ? (
        <>
          <NetworkSelect className="border-aomi-border bg-aomi-raised text-aomi-fg hover:border-aomi-muted/60 hover:bg-aomi-raised hover:text-aomi-fg focus-visible:border-aomi-border data-[state=open]:border-aomi-muted/60 h-8 rounded-full border pl-2 pr-2.5 text-[13px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:ring-0" />
          {showLibrary || showSettings || showTheme || showActivity ? (
            <span aria-hidden="true" className="bg-aomi-border h-5 w-px" />
          ) : null}
        </>
      ) : null}
      {showLibrary ? (
        <HeaderTip label="Library">
          <button
            type="button"
            onClick={onOpenPackages}
            className={headerButtonClass}
            aria-label="Open capability library"
          >
            <LibraryBig size={18} />
          </button>
        </HeaderTip>
      ) : null}
      {showSettings ? (
        <HeaderTip label="Settings">
          <button
            type="button"
            onClick={onOpenSettings}
            className={headerButtonClass}
            aria-label="Open settings"
          >
            <Settings size={18} />
          </button>
        </HeaderTip>
      ) : null}
      {showTheme ? (
        <HeaderTip label={isDark ? "Light mode" : "Dark mode"}>
          <ThemeSwitch
            dark={isDark}
            onToggle={() =>
              updateSetting("colorMode", isDark ? "light" : "dark")
            }
          />
        </HeaderTip>
      ) : null}
      {showActivity ? (
        <HeaderTip
          label={
            !activity.worthShowing
              ? "No activity yet"
              : activity.open
                ? "Hide activity"
                : "Show activity"
          }
        >
          <button
            type="button"
            disabled={!activity.worthShowing}
            onClick={() => activity.setOpen(!activity.open)}
            className={`${headerButtonClass} disabled:hover:text-aomi-muted relative disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent ${
              activity.open ? "bg-aomi-hover text-aomi-fg" : ""
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
            {activity.reviewing && !activity.open ? (
              <span
                aria-hidden="true"
                data-testid="activity-review-dot"
                className="bg-aomi-accent ring-aomi-bg absolute right-1 top-1 size-2 rounded-full ring-2"
              />
            ) : null}
          </button>
        </HeaderTip>
      ) : null}
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
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      onClick={onToggle}
      className={headerButtonClass}
    >
      {dark ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
