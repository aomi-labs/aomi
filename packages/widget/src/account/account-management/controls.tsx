import { Check, Copy, Ellipsis, Loader2, Wallet } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { cn } from "@aomi-labs/react";
import { aomiButton } from "@/ui/aomi/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { WalletMark, resolveWalletBrandKey } from "@/wallet/wallet-brands";

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
  const key = resolveWalletBrandKey(brand);
  return (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: box, height: box }}
      data-wallet-brand={key ?? undefined}
    >
      {key ? (
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

export function IconButton({
  children,
  label,
  busy = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={busy || disabled}
      onClick={onClick}
      className={aomiButton({ variant: "ghost", size: "icon" })}
    >
      {busy ? <Loader2 className="animate-spin" /> : children}
    </button>
  );
}

export type MenuItem =
  | {
      label: string;
      detail?: string;
      danger?: boolean;
      href?: string;
      onSelect?: () => unknown;
    }
  | "divider";

/** The ··· menu on a wallet or login row. */
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
  const itemClass = (danger?: boolean) =>
    cn(
      "hover:bg-aomi-hover focus:bg-aomi-hover flex w-full flex-col items-start gap-0.5 rounded-[8px] px-3 py-2 text-left outline-none",
      danger ? "text-aomi-danger" : "text-aomi-fg",
    );
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
        className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-card shadow-popover z-[90] w-max min-w-52 max-w-[calc(100vw-2rem)] border p-1"
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const nodes = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              '[role="menuitem"]',
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
        {items.map((item, index) => {
          if (item === "divider")
            return (
              <div
                key={`divider:${index}`}
                role="separator"
                className="bg-aomi-border mx-1 my-1 h-px"
              />
            );
          const body = (
            <>
              <span className="type-control">{item.label}</span>
              {item.detail ? (
                <span className="type-meta text-aomi-muted">{item.detail}</span>
              ) : null}
            </>
          );
          return (
            <Fragment key={item.label}>
              {item.href ? (
                <a
                  role="menuitem"
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className={itemClass(item.danger)}
                  onClick={() => setOpen(false)}
                >
                  {body}
                </a>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={itemClass(item.danger)}
                  onClick={() => {
                    setOpen(false);
                    void item.onSelect?.();
                  }}
                >
                  {body}
                </button>
              )}
            </Fragment>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
