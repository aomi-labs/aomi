"use client";

import { useEffect, useState, type FC } from "react";
import { ChevronDownIcon, CheckIcon } from "lucide-react";
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
import {
  groupModelsByVendor,
  getVendorForModel,
  AUTO_MODE_LABEL,
  resolveAutoModel,
} from "./model-metadata";
import { AutoModeIcon, getVendorIcon } from "@/components/icons";

export type ModelSelectProps = {
  className?: string;
  placeholder?: string;
};

export const ModelSelect: FC<ModelSelectProps> = ({
  className,
  placeholder = "Select model",
}) => {
  const {
    state,
    getAvailableModels,
    getCurrentThreadControl,
    onModelSelect,
  } = useControl();
  const { isRunning } = useAomiRuntime();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void getAvailableModels();
  }, [getAvailableModels]);

  const threadControl = getCurrentThreadControl();
  const rawSelected = threadControl.model;
  const modelMode =
    threadControl.modelMode ?? (rawSelected === null ? "auto" : "manual");
  const models = state.availableModels;

  const autoBackendModel = resolveAutoModel(models);
  const isAuto = modelMode === "auto";
  const selectedModel = isAuto
    ? autoBackendModel
    : (rawSelected ?? state.defaultModel ?? models[0]);

  if (models.length === 0) {
    return (
      <Button
        variant="ghost"
        disabled
        className={cn(
          "h-8 w-auto min-w-[100px] rounded-full px-2 text-xs",
          "text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">Loading...</span>
      </Button>
    );
  }

  const groups = groupModelsByVendor(models);

  // Display label for the trigger button
  const triggerLabel = isAuto ? AUTO_MODE_LABEL : selectedModel || placeholder;

  const handleSelect = (model: string) => {
    if (isRunning) return;
    setOpen(false);
    void onModelSelect(model, { mode: "manual" }).catch((err) => {
      console.error("[ModelSelect] onModelSelect failed:", err);
    });
  };

  const handleAutoSelect = () => {
    if (!autoBackendModel || isRunning) return;
    setOpen(false);
    void onModelSelect(autoBackendModel, { mode: "auto" }).catch((err) => {
      console.error("[ModelSelect] auto onModelSelect failed:", err);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          disabled={isRunning}
          className={cn(
            "h-8 w-auto min-w-0 justify-between rounded-full px-0.5 text-xs md:min-w-[100px] md:px-3",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            isRunning && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <div className="flex items-center gap-px md:gap-1.5">
            {(() => {
              if (isAuto) {
                return <AutoModeIcon className="h-3 w-3 shrink-0 opacity-60" />;
              }
              if (selectedModel) {
                const vendor = getVendorForModel(selectedModel);
                const VIcon = getVendorIcon(vendor.id);
                if (VIcon)
                  return <VIcon className="h-3 w-3 shrink-0 opacity-60" />;
              }
              return null;
            })()}
            <span className="truncate">{triggerLabel}</span>
          </div>
          <ChevronDownIcon className="ml-0 h-3 w-3 shrink-0 opacity-50 md:ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[280px] overflow-hidden rounded-xl p-0"
        onOpenAutoFocus={(e) => {
          if (window.matchMedia("(max-width: 767px)").matches) {
            e.preventDefault();
          }
        }}
      >
        <Command className="rounded-xl">
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>

            {/* Auto mode — pinned at top */}
            <CommandGroup>
              <CommandItem
                value="auto"
                disabled={isRunning}
                onSelect={handleAutoSelect}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                      "bg-primary/10 text-primary",
                    )}
                  >
                    <AutoModeIcon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex flex-col">
                    <span className="font-medium">{AUTO_MODE_LABEL}</span>
                    <span className="text-muted-foreground text-xs">
                      Best balance of speed & cost
                    </span>
                  </div>
                </div>
                {isAuto && <CheckIcon className="h-4 w-4 shrink-0" />}
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* Vendor-grouped models */}
            {groups.map((group) => {
              const VendorIcon = getVendorIcon(group.vendor.id);
              return (
                <CommandGroup
                  key={group.vendor.id}
                  heading={group.vendor.label}
                >
                  {group.models.map((model) => (
                    <CommandItem
                      key={model}
                      value={model}
                      disabled={isRunning}
                      onSelect={() => handleSelect(model)}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                            "bg-muted text-muted-foreground",
                          )}
                        >
                          {VendorIcon ? (
                            <VendorIcon className="h-3.5 w-3.5" />
                          ) : (
                            <span className="text-[10px] font-medium">
                              {group.vendor.abbr}
                            </span>
                          )}
                        </span>
                        <span className="truncate">{model}</span>
                      </div>
                      {!isAuto && selectedModel === model && (
                        <CheckIcon className="h-4 w-4 shrink-0" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
