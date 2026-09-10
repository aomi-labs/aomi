"use client";

import { useCallback, useRef, useState, type FC, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@aomi-labs/react";

export const controlSelectTriggerClass =
  "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg h-8 min-w-0 gap-1.5 rounded-full px-2.5 text-xs";

export const controlMenuContentClass =
  "border-aomi-border bg-aomi-raised w-[248px] overflow-hidden rounded-xl border p-2 shadow-[0_16px_40px_rgba(0,0,0,0.20)]";

export const controlMenuCommandClass =
  "bg-transparent rounded-lg [&_[cmdk-input-wrapper]]:bg-aomi-surface-2/55 [&_[cmdk-input-wrapper]]:mb-1.5 [&_[cmdk-input-wrapper]]:rounded-lg [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:px-2.5 [&_[cmdk-input-wrapper]_svg]:mr-[7px] [&_[cmdk-input-wrapper]_svg]:size-3.5 [&_[cmdk-input]]:h-8 [&_[cmdk-input]]:py-1 [&_[cmdk-input]]:text-xs";

export const controlMenuListClass =
  "max-h-[240px] overscroll-contain overflow-y-auto overflow-x-hidden p-0 pr-1";

export const controlMenuGroupClass =
  "p-0 [&_[cmdk-group-heading]]:text-aomi-muted [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.09em] [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col [&_[cmdk-group-items]]:gap-0.5";

export const controlMenuItemClass =
  "aria-selected:bg-aomi-surface-2 aria-selected:text-aomi-fg flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]";

export const controlMenuIconClass =
  "text-aomi-muted flex size-6 shrink-0 items-center justify-center";

export const controlMenuCheckClass = "text-aomi-accent size-4 shrink-0";

export const ControlMenuCheck: FC<{ selected: boolean }> = ({ selected }) => (
  <span
    aria-hidden="true"
    className="ml-2 flex w-5 shrink-0 items-center justify-center"
  >
    {selected ? <CheckIcon className={controlMenuCheckClass} /> : null}
  </span>
);

const idleHighlight = "__aomi_control_menu_idle__";

/** Keep cmdk from visually choosing its first row until the user navigates. */
export function useControlMenuHighlight() {
  const [value, setValue] = useState(idleHighlight);
  const interactionStarted = useRef(false);

  const resetHighlight = useCallback(() => {
    interactionStarted.current = false;
    setValue(idleHighlight);
  }, []);

  const startInteraction = useCallback(() => {
    interactionStarted.current = true;
  }, []);

  const onValueChange = useCallback((next: string) => {
    if (interactionStarted.current) setValue(next);
  }, []);

  return {
    resetHighlight,
    commandHighlightProps: {
      value,
      onValueChange,
      onKeyDownCapture: startInteraction,
      onPointerMoveCapture: startInteraction,
    },
  };
}

export const ControlSelectChevron: FC<{ className?: string }> = ({
  className,
}) => (
  <ChevronDownIcon
    aria-hidden="true"
    className={cn("size-3 shrink-0 opacity-50", className)}
  />
);

export const ControlMenuTitle: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="text-aomi-muted px-2.5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[0.09em]">
    {children}
  </div>
);
