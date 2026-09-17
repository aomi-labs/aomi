"use client";

import { useEffect, useState, type FC } from "react";
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
import {
  groupModelsByVendor,
  getVendorForModel,
  AUTO_MODEL_LABEL,
  resolveAutoModel,
} from "./model-metadata";
import { AutoModeIcon, getVendorIcon } from "@/components/icons";
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

export type ModelSelectProps = {
  className?: string;
  placeholder?: string;
};

export const ModelSelect: FC<ModelSelectProps> = ({
  className,
  placeholder = "Select model",
}) => {
  const { state, getAvailableModels, getCurrentThreadControl, onModelSelect } =
    useControl();
  const { isRunning } = useAomiRuntime();
  const [open, setOpen] = useState(false);
  const { resetHighlight, commandHighlightProps } = useControlMenuHighlight();

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
  const triggerLabel = isAuto ? AUTO_MODEL_LABEL : selectedModel || placeholder;

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
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        resetHighlight();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          disabled={isRunning}
          className={cn(
            controlSelectTriggerClass,
            "w-auto justify-start",
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
        onOpenAutoFocus={(e) => {
          if (window.matchMedia("(max-width: 767px)").matches) {
            e.preventDefault();
          }
        }}
      >
        <Command className={controlMenuCommandClass} {...commandHighlightProps}>
          <CommandInput placeholder="Search models..." />
          <CommandList className={controlMenuListClass}>
            <CommandEmpty>No models found.</CommandEmpty>

            {/* Auto mode — pinned at top */}
            <CommandGroup className={controlMenuGroupClass}>
              <CommandItem
                value="auto"
                disabled={isRunning}
                onSelect={handleAutoSelect}
                className={controlMenuItemClass}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={controlMenuIconClass}>
                    <AutoModeIcon className="size-4" />
                  </span>
                  <div className="flex flex-col">
                    <span className="font-medium">{AUTO_MODEL_LABEL}</span>
                    <span className="text-aomi-muted text-[11px] leading-4">
                      Balanced speed and cost
                    </span>
                  </div>
                </div>
                <ControlMenuCheck selected={isAuto} />
              </CommandItem>
            </CommandGroup>

            {/* Vendor-grouped models */}
            {groups.map((group) => {
              const VendorIcon = getVendorIcon(group.vendor.id);
              return (
                <CommandGroup
                  key={group.vendor.id}
                  heading={group.vendor.label}
                  className={controlMenuGroupClass}
                >
                  {group.models.map((model) => (
                    <CommandItem
                      key={model}
                      value={model}
                      disabled={isRunning}
                      onSelect={() => handleSelect(model)}
                      className={controlMenuItemClass}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className={controlMenuIconClass}>
                          {VendorIcon ? (
                            <VendorIcon className="size-4" />
                          ) : (
                            <span className="text-[11px] font-medium">
                              {group.vendor.abbr}
                            </span>
                          )}
                        </span>
                        <span className="truncate">{model}</span>
                      </div>
                      <ControlMenuCheck
                        selected={!isAuto && selectedModel === model}
                      />
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
