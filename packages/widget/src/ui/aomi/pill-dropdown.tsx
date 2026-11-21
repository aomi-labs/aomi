import { useRef, useState, type ReactNode } from "react";
import { CaretDownIcon, CheckIcon } from "@/icons/ui-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

export function PillDropdown({
  value,
  label,
  align = "start",
  optionIcon,
  options,
  onChange,
}: {
  label?: string;
  align?: "start" | "end";
  optionIcon?: ReactNode;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pointerOpen = useRef(false);
  const current = options.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onPointerDown={() => { pointerOpen.current = true; }}
          onKeyDown={() => { pointerOpen.current = false; }}
          aria-label={label}
          type="button"
          className="bg-[var(--aomi-g1)] text-aomi-fg hover:bg-[var(--aomi-g2)] data-[state=open]:bg-[var(--aomi-g2)] flex items-center gap-2 rounded-full px-3.5 py-[7px] text-sm font-normal"
        >
          {current?.label}
          <CaretDownIcon
            size={14}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        onOpenAutoFocus={event => {
          if (pointerOpen.current) {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus({ preventScroll: true });
          }
        }}
        collisionPadding={8}
        aria-label={current?.label}
        className="max-h-[var(--radix-popover-content-available-height)] grid w-max min-w-[185px] max-w-[var(--radix-popover-content-available-width)] gap-0.5 overflow-y-auto p-[5px]"
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
            className="aomi-menu-row aria-pressed:bg-[var(--aomi-b2)] text-aomi-fg flex min-h-9 w-full items-center gap-[9px] px-[11px] py-[7px] text-left text-sm"
          >
            {optionIcon}
            <span className="min-w-0 truncate">{option.label}</span>
            {option.id === value && (
              <CheckIcon className="text-aomi-accent-strong ml-auto shrink-0" size={14} />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
