"use client";

import { useState, type FC } from "react";
import { GaugeIcon, SparklesIcon } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useCapabilityComposer,
  type ExecutionPolicy,
} from "@/components/assistant-ui/capability-composer";
import {
  ControlMenuCheck,
  ControlMenuTitle,
  ControlSelectChevron,
  controlMenuContentClass,
  controlMenuIconClass,
  controlMenuItemClass,
  controlSelectTriggerClass,
} from "./control-menu";

const MODES: Array<{
  id: ExecutionPolicy;
  label: string;
  description: string;
  Icon: typeof SparklesIcon;
}> = [
  {
    id: "auto",
    label: "Auto",
    description: "Let Aomi choose how to handle the task",
    Icon: SparklesIcon,
  },
  {
    id: "direct",
    label: "Direct",
    description: "Send every turn to one selected app",
    Icon: GaugeIcon,
  },
];

export type ModeSelectProps = { className?: string };

export const ModeSelect: FC<ModeSelectProps> = ({ className }) => {
  const [open, setOpen] = useState(false);
  const { policy, routing, setPolicy, showModeSelect } =
    useCapabilityComposer();
  if (!showModeSelect) return null;
  const available = MODES.filter((mode) => routing.modes.includes(mode.id));
  const selected =
    available.find((mode) => mode.id === policy) ?? available[0]!;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Execution mode"
          className={cn(controlSelectTriggerClass, className)}
        >
          <selected.Icon className="size-3.5 opacity-70" />
          <span>{selected.label}</span>
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
      >
        <ControlMenuTitle>Execution mode</ControlMenuTitle>
        <div className="space-y-0.5">
          {available.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                setPolicy(mode.id);
                setOpen(false);
              }}
              className={cn(controlMenuItemClass, "hover:bg-aomi-hover")}
            >
              <span className={controlMenuIconClass}>
                <mode.Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">
                  {mode.label}
                </span>
                <span className="text-aomi-muted block text-[11px] leading-4">
                  {mode.description}
                </span>
              </span>
              <ControlMenuCheck selected={policy === mode.id} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
