import {
  Check,
  ChevronRight,
  Copy,
  Ellipsis,
  Loader2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@aomi-labs/react";
import { aomiButton } from "@/ui/aomi/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { WalletMark, resolveWalletBrandKey } from "@/wallet/wallet-brands";
import { AomiMark } from "@/ui/aomi-mark";
import { AGENT_WALLET } from "./wallet-model";

/**
 * A wallet app's mark. The dot says whether the address is usable here
 * (green) or needs a step first (grey).
 */
export function BrandMark({
  brand,
  dot,
  size = 17,
  box = 32,
}: {
  brand: string;
  dot?: "on" | "off";
  size?: number;
  box?: number;
}) {
  const agent = brand === AGENT_WALLET;
  const key = agent ? null : resolveWalletBrandKey(brand);
  return (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: box, height: box }}
      data-wallet-brand={agent ? "agent" : (key ?? undefined)}
    >
      {agent ? (
        <AomiMark size={Math.max(12, size - 2)} className="text-aomi-fg" />
      ) : key ? (
        <WalletMark name={key} size={size} />
      ) : (
        <Wallet size={Math.min(size, 16)} className="text-aomi-muted" />
      )}
      {dot ? (
        <span
          aria-hidden
          data-dot={dot}
          className={cn(
            "ring-aomi-raised absolute rounded-full ring-2",
            dot === "on" ? "bg-aomi-success" : "bg-aomi-muted/60",
          )}
          style={{
            width: Math.max(6, Math.round(box / 5)),
            height: Math.max(6, Math.round(box / 5)),
            right: Math.round((box - size) / 2) - 2,
            bottom: Math.round((box - size) / 2) - 2,
          }}
        />
      ) : null}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={value}
      className={aomiButton({ variant: "ghost", size: "icon-sm" })}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(value).then(() => setCopied(true));
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export const copyText = (value: string) =>
  navigator.clipboard.writeText(value).catch(() => undefined);

export function TextButton({
  children,
  danger = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={aomiButton({
        variant: danger ? "danger" : "secondary",
        size: "sm",
      })}
    >
      {busy ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export type MenuItem = {
  label: string;
  icon: LucideIcon;
  /** Destructive: drawn red, always last, after a divider. */
  danger?: boolean;
  /** One of a choice; the chosen item is filled. */
  checked?: boolean;
  href?: string;
  onSelect?: () => unknown;
};

/**
 * The ⋯ menu on a wallet, login or connection row: icon + label rows, with
 * the destructive item last after a divider whatever order it was given in.
 */
export function ActionsMenu({
  label,
  items,
  disabled = false,
  busy = false,
}: {
  label: string;
  items: MenuItem[];
  disabled?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const safe = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  const itemClass = (item: MenuItem) =>
    cn(
      "hover:bg-aomi-hover focus:bg-aomi-hover flex min-h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] font-medium leading-5 outline-none",
      item.danger ? "text-aomi-danger" : "text-aomi-fg",
      item.checked && "bg-aomi-surface-2",
    );
  const row = (item: MenuItem) => {
    const Icon = item.icon;
    const body = (
      <>
        <Icon
          className={cn(
            "size-4 shrink-0",
            item.danger ? "text-aomi-danger" : "text-aomi-muted",
          )}
        />
        {item.label}
      </>
    );
    return item.href ? (
      <a
        key={item.label}
        role="menuitem"
        href={item.href}
        target="_blank"
        rel="noreferrer"
        className={itemClass(item)}
        onClick={() => setOpen(false)}
      >
        {body}
      </a>
    ) : (
      <button
        key={item.label}
        type="button"
        role={item.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={item.checked}
        className={itemClass(item)}
        onClick={() => {
          setOpen(false);
          void item.onSelect?.();
        }}
      >
        {body}
      </button>
    );
  };
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          className={aomiButton({ variant: "ghost", size: "icon-sm" })}
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Ellipsis className="size-4" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={label}
        align="end"
        sideOffset={5}
        className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-card shadow-popover z-[90] w-max min-w-48 max-w-[calc(100vw-2rem)] border p-1"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const nodes = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              '[role^="menuitem"]',
            ),
          );
          const current = nodes.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? nodes.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    nodes.length) %
                  nodes.length;
          nodes[next]?.focus();
        }}
      >
        {safe.map(row)}
        {safe.length && danger.length ? (
          <div role="separator" className="bg-aomi-border mx-1 my-1 h-px" />
        ) : null}
        {danger.map(row)}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The chevron in front of an expandable row's logo; it points down when
 * open. `blank` keeps the gutter empty so logos line up across a list.
 */
export function ExpandToggle({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  /** What it shows or hides, e.g. "Privy addresses". */
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="text-aomi-muted hover:text-aomi-fg focus-visible:ring-aomi-accent-strong/40 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2"
    >
      <ChevronRight
        className={cn(
          "size-3.5 transition-transform motion-reduce:transition-none",
          open && "rotate-90",
        )}
      />
    </button>
  );
}

/** The empty gutter of a row that doesn't expand, in a list where others do. */
export const GutterSpacer = () => (
  <span aria-hidden className="size-[18px] shrink-0" />
);

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** A section band inside the wallets card, with an optional action at its end. */
export function Divider({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-aomi-border bg-aomi-surface-2/60 flex items-baseline gap-2 border-y px-3.5 py-1.5 first:border-t-0">
      <span className="type-meta text-aomi-fg shrink-0 font-medium">
        {title}
      </span>
      <span className="type-meta text-aomi-muted min-w-0 truncate">
        {detail}
      </span>
      {action ? (
        <span className="-my-1.5 ml-auto self-center">{action}</span>
      ) : null}
    </div>
  );
}
