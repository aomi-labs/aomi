import { useState, type ReactNode } from "react";
import { cn } from "@aomi-labs/widget";
import {
  ControlMenuCheck,
  ControlSelectChevron,
  Popover,
  PopoverContent,
  PopoverTrigger,
  controlMenuContentClass,
  controlMenuItemClass,
} from "@aomi-labs/widget/host-composition";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** A count at the end of the menu row. */
  count?: number;
  /** A dot or icon before the label. */
  leading?: ReactNode;
};

/**
 * The toolbar filter: a 36px trigger reading "Label Value ▾" that opens the
 * widget's control menu. One value is chosen at a time.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-control hover:border-aomi-muted/60 data-[state=open]:border-aomi-muted/60 inline-flex h-9 min-w-0 shrink-0 items-center gap-1.5 border pl-3 pr-2.5 text-[13px]"
      >
        <span className="text-aomi-muted">{label}</span>
        <span className="truncate font-medium">{current?.label ?? value}</span>
        <ControlSelectChevron className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(controlMenuContentClass, "w-auto min-w-[220px] p-1")}
      >
        <div role="menu" aria-label={label} className="flex flex-col gap-px">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                controlMenuItemClass,
                "hover:bg-aomi-surface-2 aria-checked:bg-aomi-surface-2 min-h-8 rounded-[8px] px-2",
              )}
            >
              {option.leading}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.count != null ? (
                <span className="text-aomi-muted text-[12px]">
                  {option.count}
                </span>
              ) : null}
              <ControlMenuCheck selected={option.value === value} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
