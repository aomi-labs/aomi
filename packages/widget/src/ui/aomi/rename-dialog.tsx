"use client";

import { lazy, Suspense, useState, type ReactNode } from "react";

// Loaded on first open, so rows that can be renamed stay light.
const RenameDialogBody = lazy(() =>
  import("./rename-dialog-body").then((module) => ({
    default: module.RenameDialogBody,
  })),
);

export type RenameOptions = {
  title: string;
  description?: ReactNode;
  /** The current name; the field opens with it selected. */
  value: string;
  placeholder?: string;
  maxLength?: number;
  /** Allow saving an empty name (it clears a label back to the default). */
  allowEmpty?: boolean;
  /** Saves the trimmed name; `false` or a throw keeps the dialog open. */
  onSave: (name: string) => Promise<boolean | void> | boolean | void;
};

/**
 * Every rename in Aomi: a Name field with Cancel and Save. Enter saves, Escape
 * cancels; Save waits for the write and stays open with an error on failure.
 *
 *   const { rename, dialog } = useRenameDialog();
 *   rename({ title: "Rename wallet", value: wallet.name, onSave });
 */
export function useRenameDialog(): {
  rename: (options: RenameOptions) => void;
  dialog: ReactNode;
} {
  const [options, setOptions] = useState<RenameOptions | null>(null);
  const dialog = options ? (
    <Suspense fallback={null}>
      <RenameDialogBody options={options} onClose={() => setOptions(null)} />
    </Suspense>
  ) : null;
  return { rename: setOptions, dialog };
}
