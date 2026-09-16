"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type WalletPickerContextValue = {
  open: boolean;
  openPicker: () => void;
  closePicker: () => void;
};

const WalletPickerContext = createContext<WalletPickerContextValue | null>(
  null,
);

export function WalletPickerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPicker = useCallback(() => setOpen(true), []);
  const closePicker = useCallback(() => setOpen(false), []);

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
