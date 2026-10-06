"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { AomiButton } from "./button";

export type ConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  /** Extra body below the description (a summary card, an address…). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` fills the confirm button red; use it for irreversible actions. */
  tone?: "default" | "danger";
};

export type ConfirmDialogProps = ConfirmDialogOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Disables both buttons and blocks dismissal while work runs. */
  busy?: boolean;
  /** Label shown on the confirm button while `busy`. */
  busyLabel?: string;
  /** Close as soon as confirm is pressed (default). Turn off to drive `busy`. */
  closeOnConfirm?: boolean;
  /** Portal target, for hosts that scope the theme class below <body>. */
  container?: HTMLElement | null;
};

/**
 * The in-app replacement for `window.confirm`: a small modal alert with a
 * title, optional description/body, Cancel and a confirm action. Cancel holds
 * initial focus so Enter never commits a destructive action by accident.
 * For the one-line `if (!confirm(…)) return` shape, use `useConfirmDialog`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  busyLabel,
  closeOnConfirm = true,
  container,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[3px]" />
        <Dialog.Content
          role="alertdialog"
          // Radix wires aria-describedby to Description; opt out without one.
          {...(description ? {} : { "aria-describedby": undefined })}
          className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-shell shadow-modal fixed left-1/2 top-1/2 z-[81] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border p-5 focus:outline-none"
        >
          <Dialog.Title className="type-title">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="type-control text-aomi-muted mt-1.5">
              {description}
            </Dialog.Description>
          ) : null}
          {children ? <div className="mt-4">{children}</div> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <AomiButton variant="ghost" disabled={busy}>
                {cancelLabel}
              </AomiButton>
            </Dialog.Close>
            <AomiButton
              variant={tone === "danger" ? "danger-fill" : "primary"}
              disabled={busy}
              onClick={() => {
                onConfirm();
                if (closeOnConfirm) onOpenChange(false);
              }}
            >
              {busy && busyLabel ? busyLabel : confirmLabel}
            </AomiButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Promise-returning confirm for handlers that used `window.confirm`:
 *
 *   const { confirm, dialog } = useConfirmDialog();
 *   if (!(await confirm({ title: "Unlink wallet?", tone: "danger" }))) return;
 *   …
 *   return <>{…}{dialog}</>;
 *
 * Resolves `true` on confirm, `false` on cancel, Escape, outside click or
 * unmount. Render `dialog` once anywhere in the component.
 */
export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmDialogOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setRequest(null);
  }, []);

  useEffect(() => () => resolver.current?.(false), []);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    // A second request supersedes an unanswered one, which counts as cancel.
    resolver.current?.(false);
    setRequest(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      {...request}
      title={request?.title}
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      onConfirm={() => settle(true)}
      closeOnConfirm={false}
    />
  );

  return { confirm, dialog };
}
