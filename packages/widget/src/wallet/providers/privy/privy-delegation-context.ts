"use client";

import { createContext, useContext } from "react";

export type PrivyDelegationContextValue = {
  start: (input: { state: string; signerId: string }) => Promise<void>;
};

export const PrivyDelegationContext =
  createContext<PrivyDelegationContextValue>({
    start: async () => {
      throw new Error("Privy is not configured for this app.");
    },
  });

export function usePrivyDelegation(): PrivyDelegationContextValue {
  return useContext(PrivyDelegationContext);
}
