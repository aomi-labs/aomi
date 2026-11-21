import { useState } from "react";
import { CaretDownIcon, CheckIcon } from "@/icons/ui-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

export function PillDropdown({
  value,
  label,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          type="button"
          className="bg-[var(--aomi-g1)] text-aomi-fg hover:bg-[var(--aomi-g2)] flex items-center gap-2 rounded-full px-3.5 py-[7px] text-xs font-medium"
        >
          {current?.label}
          <CaretDownIcon
            size={12}
            className={`text-aomi-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        aria-label={current?.label}
        className="max-h-[var(--radix-popover-content-available-height)] w-max min-w-40 overflow-y-auto"
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            onClick={() => {
              onChange(option.id);
              setOpen(false);
            }}
            className="aomi-menu-row aria-pressed:bg-[var(--aomi-b2)] text-aomi-fg flex min-h-9 w-full items-center justify-between gap-3 px-2.5 text-left text-[13px]"
          >
            {option.label}
            {option.id === value && (
              <CheckIcon className="text-aomi-accent-strong" size={14} />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
