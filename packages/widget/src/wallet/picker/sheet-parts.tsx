"use client";

import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRightIcon, Loader2Icon, WalletIcon } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { ModalCloseButton } from "@/ui/aomi/modal-shell";
import { AomiButton } from "@/ui/aomi/button";
import { ListRow } from "@/ui/aomi/list-group";
import { resolveWalletBrandKey, WalletMark } from "@/wallet/wallet-brands";
import { shortAddress } from "@aomi-labs/client";

/** Title, description and close, as in every Aomi dialog. */
export function SheetHeader({
  title,
  description,
  leading,
  onClose,
}: {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="flex items-start gap-3 px-5 pb-3 pt-5">
      {leading}
      <div className="min-w-0 flex-1">
        <Dialog.Title className="type-title">{title}</Dialog.Title>
        {description ? (
          <Dialog.Description className="type-meta text-aomi-muted mt-1">
            {description}
          </Dialog.Description>
        ) : null}
      </div>
      <ModalCloseButton label="Close" onClick={onClose} className="-mr-1" />
    </header>
  );
}

/** A wallet app's brand mark from `wallet-brands`, or its own icon. */
export function BrandMark({
  brand,
  iconUrl,
  size = 20,
}: {
  brand?: string;
  iconUrl?: string;
  size?: number;
}) {
  const known = brand ? resolveWalletBrandKey(brand) : null;
  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{ width: size + 12, height: size + 12 }}
      aria-hidden
    >
      {known ? (
        <WalletMark name={known} size={size} />
      ) : iconUrl ? (
        <img src={iconUrl} alt="" width={size} height={size} />
      ) : (
        <WalletIcon className="text-aomi-muted" size={size * 0.8} />
      )}
    </span>
  );
}

/** One clickable row in a `ListGroup`. */
export function ChoiceRow({
  leading,
  title,
  description,
  disabled,
  onClick,
  onPointerEnter,
}: {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  onPointerEnter?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onFocus={onPointerEnter}
      className="hover:bg-aomi-hover focus-visible:ring-aomi-ring/50 block w-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50"
    >
      <ListRow
        leading={leading}
        title={title}
        description={description}
        trailing={<ChevronRightIcon className="text-aomi-muted size-4" />}
      />
    </button>
  );
}

export function AddressChip({ address }: { address: string }) {
  return (
    <span className="rounded-control bg-aomi-surface-2 type-address px-2.5 py-1">
      {shortAddress(address)}
    </span>
  );
}

/** The quiet full-width button that shows what Aomi is waiting for. */
export function WaitingButton({ children }: { children: ReactNode }) {
  return (
    <AomiButton disabled className="h-10 w-full disabled:opacity-100">
      <Loader2Icon className="size-4 animate-spin" />
      {children}
    </AomiButton>
  );
}

export function SheetAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-control bg-aomi-danger/10 text-aomi-danger type-meta px-3 py-2"
    >
      {children}
    </div>
  );
}

export function SheetFootnote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("type-meta text-aomi-muted text-center", className)}>
      {children}
    </p>
  );
}

/** An inline text action inside a footnote. */
export function FootnoteLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:text-aomi-fg underline underline-offset-2"
    >
      {children}
    </button>
  );
}
