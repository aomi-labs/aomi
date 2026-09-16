"use client";

import { useState, useEffect, type FC } from "react";
import { BotIcon, ChevronDownIcon, CheckIcon } from "lucide-react";
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
  CommandSeparator,
} from "@/components/ui/command";
import { getAppInfo, groupAppsByCategory } from "./app-metadata";
import { AllAppsIcon, getAppIcon } from "@/components/icons";

export type AppSelectProps = {
  className?: string;
  placeholder?: string;
};

/** The Basic mode, with no individual app selected. */
const ALL_APPS_ID = "default";

/**
 * The orchestrator is a *mode*, not a venue: it coordinates child agents rather
 * than wrapping one protocol. It gets the same pinned two-line treatment as
 * the Basic mode, directly beneath it, and is kept out of the category
 * groups so it is not listed twice.
 */
const ORCHESTRATOR_ID = "orchestrator";

export const AppSelect: FC<AppSelectProps> = ({
  className,
  placeholder = "Select App",
}) => {
  const {
    state,
    getAuthorizedApps,
    getCurrentThreadApp,
    getCurrentThreadApplicationId,
    onAppSelect,
  } = useControl();
  const { isRunning } = useAomiRuntime();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void getAuthorizedApps();
  }, [getAuthorizedApps]);

  const selectApp = (id: string, applicationId?: string | number | null) => {
    if (isRunning) return;
    onAppSelect(id, { applicationId });
    setOpen(false);
  };

  const selectedApp = getCurrentThreadApp();
  const selectedApplicationId = getCurrentThreadApplicationId();
  const selectedInfo = getAppInfo(selectedApp);
  const SelectedAppIcon =
    selectedApp === ORCHESTRATOR_ID ? BotIcon : getAppIcon(selectedApp);

  const apps = state.authorizedApps;

  // Separate the pinned rows ("default" / orchestrator) from the rest
  const hasAllApps = apps.includes(ALL_APPS_ID);
  const hasOrchestrator = apps.includes(ORCHESTRATOR_ID);
  const isPinned = (name: string) =>
    name === ALL_APPS_ID || name === ORCHESTRATOR_ID;
  const otherApps =
    state.appDescriptors.length > 0
      ? state.appDescriptors.filter((app) => !isPinned(app.name))
      : apps.filter((app) => !isPinned(app));
  const groups = groupAppsByCategory(otherApps);
  const orchestratorApplicationId = state.appDescriptors.find(
    (app) => app.name === ORCHESTRATOR_ID,
  )?.applicationId;

  if (apps.length === 0) {
    return (
      <Button
        variant="ghost"
        disabled
        className={cn(
          "h-8 w-auto min-w-[80px] rounded-full px-2 text-xs",
          "text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">{selectedInfo.displayName}</span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          disabled={isRunning}
          className={cn(
            "h-8 w-auto min-w-0 justify-between gap-px rounded-full px-0.5 text-xs md:min-w-[80px] md:gap-1.5 md:px-3",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            isRunning && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          {SelectedAppIcon && (
            <SelectedAppIcon className="h-3 w-3 shrink-0 opacity-60" />
          )}
          <span className="truncate">{selectedInfo.displayName}</span>
          <ChevronDownIcon className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[260px] overflow-hidden rounded-xl p-0"
        onOpenAutoFocus={(e) => {
          if (window.matchMedia("(max-width: 767px)").matches) {
            e.preventDefault();
          }
        }}
      >
        <Command className="rounded-xl">
          <CommandInput placeholder="Search apps..." />
          <CommandList>
            <CommandEmpty>No apps found.</CommandEmpty>

            {/* Basic + the orchestrator mode —
                pinned above the category groups */}
            {(hasAllApps || hasOrchestrator) && (
              <>
                <CommandGroup>
                  {hasAllApps && (
                    <CommandItem
                      value="basic default no app"
                      disabled={isRunning}
                      onSelect={() => selectApp(ALL_APPS_ID)}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                            "bg-primary/10 text-primary",
                          )}
                        >
                          <AllAppsIcon className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex flex-col">
                          <span className="font-medium">Basic</span>
                          <span className="text-muted-foreground text-xs">
                            Use Basic without selecting an app
                          </span>
                        </div>
                      </div>
                      {selectedApp === ALL_APPS_ID && (
                        <CheckIcon className="h-4 w-4 shrink-0" />
                      )}
                    </CommandItem>
                  )}
                  {hasOrchestrator && (
                    <CommandItem
                      value="orchestrator modes agents delegate"
                      disabled={isRunning}
                      onSelect={() =>
                        selectApp(ORCHESTRATOR_ID, orchestratorApplicationId)
                      }
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                            "bg-primary/10 text-primary",
                          )}
                        >
                          <BotIcon className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex flex-col">
                          <span className="font-medium">Orchestrator</span>
                          <span className="text-muted-foreground text-xs">
                            Coordinate work across any number of apps
                          </span>
                        </div>
                      </div>
                      {selectedApp === ORCHESTRATOR_ID && (
                        <CheckIcon className="h-4 w-4 shrink-0" />
                      )}
                    </CommandItem>
                  )}
                </CommandGroup>
                {otherApps.length > 0 && <CommandSeparator />}
              </>
            )}

            {/* Category-grouped apps */}
            {groups.map((group) => (
              <CommandGroup
                key={group.category.id}
                heading={group.category.label}
              >
                {group.apps.map((app) => {
                  const AppIcon = getAppIcon(app.id);
                  const selected =
                    selectedApp === app.id &&
                    String(selectedApplicationId ?? "") ===
                      String(app.applicationId ?? "");
                  return (
                    <CommandItem
                      key={`${app.id}:${app.applicationId ?? "unscoped"}`}
                      value={`${app.displayName} ${app.category.label} ${app.id}`}
                      disabled={isRunning}
                      onSelect={() => selectApp(app.id, app.applicationId)}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-medium",
                            "bg-muted text-muted-foreground",
                            selected && "bg-primary/10 text-primary",
                          )}
                        >
                          {AppIcon ? <AppIcon className="h-4 w-4" /> : app.abbr}
                        </span>
                        <span className="truncate">{app.displayName}</span>
                      </div>
                      {selected && (
                        <CheckIcon className="text-primary h-4 w-4 shrink-0" />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
