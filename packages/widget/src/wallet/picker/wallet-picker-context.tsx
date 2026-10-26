"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAomiWalletKit } from "@/wallet/context";
import { useSheetChannel } from "@/wallet/picker/picker-context";
import { CLOSED_SHEET, sheetReducer, type SheetState } from "./sheet-machine";
import { useSheetFlow, type SheetFlow } from "./use-sheet-flow";
import { useWalletAppSwitch } from "./use-wallet-app-switch";

export { WalletSignInOptionsContext } from "@/wallet/picker/picker-context";

/** Why a page asks to sign in, shown in one muted row under the header. */
export type SheetPurpose = { icon?: ReactNode; text: string };

export type WalletPickerContextValue = {
  open: boolean;
  /** Opens the sheet for whatever the user needs next: sign in, verify or add. */
  openPicker: (options?: { purpose?: SheetPurpose }) => void;
  /** The purpose of the open sign-in, if its opener gave one. */
  purpose?: SheetPurpose;
  closePicker: () => void;
  sheet: SheetState;
  flow: SheetFlow;
};

const WalletPickerContext = createContext<WalletPickerContextValue | null>(
  null,
);

const OPEN_WALLET_PICKER_EVENT = "aomi:open-wallet-picker";

/** Open the wallet sheet from host-owned overlays outside the widget. */
export function requestWalletPickerOpen() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_WALLET_PICKER_EVENT));
}

/**
 * Owns the frame's one wallet sheet. It answers the kit (`openAddWallet`,
 * `openVerify`, `activateWallet`) and the wallet app switching accounts on
 * its own.
 */
export function WalletPickerProvider({ children }: { children: ReactNode }) {
  const kit = useAomiWalletKit();
  const [sheet, dispatch] = useReducer(sheetReducer, CLOSED_SHEET);
  const flow = useSheetFlow(kit, sheet, dispatch);
  const channel = useSheetChannel();
  const [purpose, setPurpose] = useState<SheetPurpose>();
  const openPicker = useCallback(
    (options?: { purpose?: SheetPurpose }) => {
      setPurpose(options?.purpose);
      flow.open();
    },
    [flow],
  );

  useEffect(() => {
    if (!channel) return;
    return channel.subscribe(flow.handleRequest);
  }, [channel, flow.handleRequest]);
  const isOpen = sheet.step !== "closed";
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !isOpen) {
      channel?.closed();
      setPurpose(undefined);
    }
    wasOpen.current = isOpen;
  }, [channel, isOpen]);
  useEffect(() => {
    window.addEventListener(OPEN_WALLET_PICKER_EVENT, flow.open);
    return () =>
      window.removeEventListener(OPEN_WALLET_PICKER_EVENT, flow.open);
  }, [flow.open]);
  useWalletAppSwitch(kit, flow.handleAppSwitch);

  const value = useMemo<WalletPickerContextValue>(
    () => ({
      open: sheet.step !== "closed",
      openPicker,
      purpose,
      closePicker: flow.close,
      sheet,
      flow,
    }),
    [flow, openPicker, purpose, sheet],
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
