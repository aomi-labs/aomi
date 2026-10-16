"use client";

import { useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@aomi-labs/react";
import { ModalBackdrop } from "@/ui/modal-backdrop";
import { useWidgetOverlay } from "@/ui/widget-scope";

/**
 * The wallet popup's card: every Aomi popup and standalone page (connect,
 * sign) renders in it. Build its content from `sheet-parts`. Without a
 * backdrop the page shows behind it and stays clickable.
 */
export function AomiSheet({
  children,
  onClose,
  backdrop = true,
}: {
  children: ReactNode;
  /** Backdrop click and Escape; omitted, only the header's close button closes. */
  onClose?: () => void;
  backdrop?: boolean;
}) {
  const overlay = useWidgetOverlay();
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
      // Wallet and provider popups must stay usable while a step waits on them.
      modal={false}
    >
      <Dialog.Portal container={overlay}>
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            openerRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            // Focus the card, not its first button: a ring on × reads as a hover.
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus();
            openerRef.current = null;
          }}
          aria-modal="true"
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "animate-in fade-in-0 fixed inset-0 z-[80] flex items-center justify-center p-4 outline-none duration-150",
            backdrop ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          {backdrop ? (
            <ModalBackdrop aria-label="Close" onClick={onClose} />
          ) : null}
          <div className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-shell shadow-modal animate-in zoom-in-95 fade-in-0 pointer-events-auto relative z-10 flex max-h-[min(720px,92vh)] w-full max-w-[400px] flex-col overflow-hidden border text-left duration-200">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
