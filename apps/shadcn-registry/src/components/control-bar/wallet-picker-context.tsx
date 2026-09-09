"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AomiWalletOption } from "../../lib/wallet-kit/types";

/** Host-owned provider choices; selecting one does not grant wallet authority. */
export const WalletSignInOptionsContext = createContext<
  readonly (AomiWalletOption & { connect: () => Promise<void> })[]
>([]);

export type WalletPickerContextValue = {
  open: boolean;
  openPicker: () => void;
  closePicker: () => void;
};

const WalletPickerContext = createContext<WalletPickerContextValue | null>(
  null,
);

const OPEN_WALLET_PICKER_EVENT = "aomi:open-wallet-picker";

/** Open the canonical wallet chooser from host-owned overlays such as Settings. */
export function requestWalletPickerOpen() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_WALLET_PICKER_EVENT));
}

export function WalletPickerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPicker = useCallback(() => setOpen(true), []);
  const closePicker = useCallback(() => setOpen(false), []);

  useEffect(() => {
    window.addEventListener(OPEN_WALLET_PICKER_EVENT, openPicker);
    return () =>
      window.removeEventListener(OPEN_WALLET_PICKER_EVENT, openPicker);
  }, [openPicker]);

  const value = useMemo<WalletPickerContextValue>(
    () => ({
      open,
      openPicker,
      closePicker,
    }),
    [open, openPicker, closePicker],
  );

  return (
    <WalletPickerContext.Provider value={value}>
      {children}
    </WalletPickerContext.Provider>
  );
}

export function useWalletPicker(): WalletPickerContextValue {
  const context = useContext(WalletPickerContext);
  if (!context) {
    throw new Error("useWalletPicker must be used within WalletPickerProvider");
  }
  return context;
}
