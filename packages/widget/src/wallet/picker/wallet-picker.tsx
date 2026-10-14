"use client";

import { useContext, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ModalBackdrop } from "@/ui/modal-backdrop";
import { useWidgetOverlay } from "@/ui/widget-scope";
import { useWalletPicker } from "./wallet-picker-context";
import { WalletSignInOptionsContext } from "./sign-in-options";
import { ChooseStep } from "./choose-step";
import { ChainStep, WalletStep } from "./wallet-step";
import { MergeStep } from "./merge-step";

/** The wallet sheet: sign in, add a wallet, verify, switch, merge. */
export function WalletPicker() {
  const widgetOverlay = useWidgetOverlay();
  const { sheet, flow, open } = useWalletPicker();
  const hostOptions = useContext(WalletSignInOptionsContext);
  const openerRef = useRef<HTMLElement | null>(null);

  // Warm the provider SDKs as the sheet opens, so a click can open login at once.
  useEffect(() => {
    if (open) for (const option of hostOptions) option.preload?.();
  }, [hostOptions, open]);

  if (sheet.step === "closed") return null;

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) flow.close();
      }}
      // Wallet and provider popups must stay usable while a step waits on them.
      modal={false}
    >
      <Dialog.Portal container={widgetOverlay}>
        <Dialog.Content
          onOpenAutoFocus={() => {
            openerRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus();
            openerRef.current = null;
          }}
          aria-modal="true"
          onInteractOutside={(event) => event.preventDefault()}
          className="animate-in fade-in-0 pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center p-4 outline-none duration-150"
        >
          <ModalBackdrop aria-label="Close" onClick={flow.close} />
          <div className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-shell shadow-modal animate-in zoom-in-95 fade-in-0 relative z-10 flex max-h-[min(720px,92vh)] w-full max-w-[400px] flex-col overflow-hidden border text-left duration-200">
            {sheet.step === "choose" ? (
              <ChooseStep mode={sheet.mode} error={sheet.error} flow={flow} />
            ) : sheet.step === "chain" ? (
              <ChainStep brand={sheet.brand} flow={flow} />
            ) : sheet.step === "merge" ? (
              <MergeStep sheet={sheet} flow={flow} />
            ) : (
              <WalletStep sheet={sheet} flow={flow} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
