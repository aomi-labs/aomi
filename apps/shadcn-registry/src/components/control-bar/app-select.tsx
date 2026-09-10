"use client";

import { useState, type FC } from "react";
import { useAomiRuntime, useControl, cn } from "@aomi-labs/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandInput,
} from "@/components/ui/command";
import { resolveAppIdentity } from "../../lib/apps/app-identity";
import { getAppIcon } from "@/components/icons";
import { useCapabilityComposer } from "@/components/assistant-ui/capability-composer";
import { sameDirectRoutingApp } from "@/components/assistant-ui/routing";
import {
  ControlMenuCheck,
  ControlSelectChevron,
  controlMenuCommandClass,
  controlMenuContentClass,
  controlMenuGroupClass,
  controlMenuIconClass,
  controlMenuItemClass,
  controlMenuListClass,
  controlSelectTriggerClass,
  useControlMenuHighlight,
} from "./control-menu";

export type AppSelectProps = {
  className?: string;
  placeholder?: string;
};

export const AppSelect: FC<AppSelectProps> = ({
  className,
  placeholder = "Select app",
}) => {
  const { state } = useControl();
  const { isRunning } = useAomiRuntime();
  const { routing, selectedDirectApp, selectDirectApp, showDirectAppSelect } =
    useCapabilityComposer();
  const [open, setOpen] = useState(false);
  const { resetHighlight, commandHighlightProps } = useControlMenuHighlight();
  if (!showDirectAppSelect) return null;

  const rows = routing.directApps.map((target) => {
    const descriptor = state.appDescriptors.find((candidate) =>
      typeof target.applicationId === "number"
        ? String(candidate.applicationId ?? "") === String(target.applicationId)
        : candidate.name === target.app,
    );
    const appName = target.app ?? descriptor?.name ?? "";
    const info = resolveAppIdentity(descriptor ?? appName);
    return {
      target,
      appName,
      label: appName ? info.displayName : `Application ${target.applicationId}`,
      Icon: getAppIcon(info.brandId),
      description: info.category.label,
      search: `${appName} ${descriptor?.label ?? ""} ${info.displayName}`,
    };
  });
  const selected = rows.find(
    (row) =>
      selectedDirectApp && sameDirectRoutingApp(row.target, selectedDirectApp),
  );
  const SelectedIcon = selected?.Icon;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        resetHighlight();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Direct app"
          disabled={isRunning}
          className={cn(
            controlSelectTriggerClass,
            isRunning && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          {SelectedIcon ? (
            <SelectedIcon className="size-3.5 opacity-70" />
          ) : null}
          <span className="max-w-32 truncate">
            {selected?.label ?? placeholder}
          </span>
          <ControlSelectChevron />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        avoidCollisions
        collisionPadding={8}
        className={controlMenuContentClass}
        onOpenAutoFocus={(event) => {
          if (
            typeof window.matchMedia === "function" &&
            window.matchMedia("(max-width: 767px)").matches
          ) {
            event.preventDefault();
          }
        }}
      >
        <Command className={controlMenuCommandClass} {...commandHighlightProps}>
          <CommandInput placeholder="Search apps..." />
          <CommandList className={controlMenuListClass}>
            <CommandEmpty>No apps found.</CommandEmpty>
            <CommandGroup className={controlMenuGroupClass}>
              {rows.map((row) => {
                const isSelected = Boolean(
                  selectedDirectApp &&
                  sameDirectRoutingApp(row.target, selectedDirectApp),
                );
                return (
                  <CommandItem
                    key={
                      typeof row.target.applicationId === "number"
                        ? `id:${row.target.applicationId}`
                        : `app:${row.target.app}`
                    }
                    value={`${row.label} ${row.search}`}
                    aria-label={row.label}
                    disabled={isRunning}
                    onSelect={() => {
                      if (isRunning) return;
                      selectDirectApp(row.target);
                      setOpen(false);
                    }}
                    className={controlMenuItemClass}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className={controlMenuIconClass}>
                        {row.Icon ? (
                          <row.Icon className="size-4" />
                        ) : (
                          row.label.slice(0, 2).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {row.label}
                        </span>
                        <span className="text-aomi-muted block truncate text-[11px] leading-4">
                          {row.description}
                        </span>
                      </span>
                    </div>
                    <ControlMenuCheck selected={isSelected} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
