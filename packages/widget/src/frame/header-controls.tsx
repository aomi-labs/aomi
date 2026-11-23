"use client";

import type { ReactElement } from "react";
import {
  BooksIcon,
  GearSixIcon,
  ListBulletsIcon,
  MoonIcon,
  SunIcon,
} from "@/icons/ui-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { NetworkSelect } from "@/controls/network-select";
import { useActivityPanel } from "@/sidebar/activity/activity-panel-context";
import { useShellTransport } from "@/account/transport";
import { useSettings } from "@/account/use-settings";

/**
 * Every header control stands 32px square so the row reads as one cluster;
 * on phones each grows to a 36px touch target.
 */
const headerButtonClass =
  "aomi-icon-trigger size-8 max-md:size-9";

/** Names each icon on hover; the span keeps the tip working on a disabled button. */
function HeaderTip({
  label,
  children,
  disabled,
}: {
  disabled?: boolean;
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{children}</span> : children}
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
    // On phones the network pill drops its label so every control fits.
    <div className="flex min-w-0 items-center gap-1 md:gap-2.5">
      {showNetwork ? (
        <>
          <NetworkSelect className="pl-2 pr-2.5 text-[13px] font-medium max-md:mr-1 max-md:h-9 max-md:[&>span.truncate]:sr-only" />
          {showLibrary || showSettings || showTheme || showActivity ? (
            <span
              aria-hidden="true"
              className="bg-aomi-border h-5 w-px max-md:hidden"
            />
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
            <BooksIcon size={20} />
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
            <GearSixIcon size={20} />
          </button>
        </HeaderTip>
      ) : null}
      {showTheme ? (
        <HeaderTip label={isDark ? "Light mode" : "Dark mode"}>
          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            aria-label="Dark mode"
            onClick={() => updateSetting("colorMode", isDark ? "light" : "dark")}
            className={headerButtonClass}
          >
            {isDark ? <MoonIcon size={20} /> : <SunIcon size={20} />}
          </button>
        </HeaderTip>
      ) : null}
      {showActivity ? (
        <HeaderTip
          disabled={!activity.worthShowing}
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
            <ListBulletsIcon size={20} />
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
