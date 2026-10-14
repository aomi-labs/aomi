"use client";

import { createContext, useContext } from "react";

/** What the kit asks the wallet sheet to show. */
export type SheetRequest =
  | { kind: "add" }
  | { kind: "verify" }
  | { kind: "switch"; key: string }
  | { kind: "connect"; key: string };

/**
 * One per wallet kit: the kit asks, and the frame's wallet sheet answers, so
 * Settings and menus can open sign-in steps. Only the latest sheet answers,
 * so a request never opens two.
 */
export function createSheetChannel() {
  const listeners = new Set<(request: SheetRequest) => void>();
  const closeListeners = new Set<() => void>();
  return {
    request(request: SheetRequest) {
      [...listeners].at(-1)?.(request);
    },
    subscribe(listener: (request: SheetRequest) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The sheet closed, finished or dismissed. */
    closed() {
      for (const listener of closeListeners) listener();
    },
    onClosed(listener: () => void) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
  };
}

export type SheetChannel = ReturnType<typeof createSheetChannel>;

export const SheetChannelContext = createContext<SheetChannel | null>(null);

export const useSheetChannel = () => useContext(SheetChannelContext);
