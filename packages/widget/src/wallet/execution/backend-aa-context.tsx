"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GetAccountBearer } from "@aomi-labs/client";

type BackendAaContextValue = {
  apiUrl: string;
  getAccountBearer?: GetAccountBearer;
};

const BackendAaContext = createContext<BackendAaContextValue | null>(null);

export function BackendAaProvider({
  value,
  children,
}: {
  value: BackendAaContextValue;
  children: ReactNode;
}) {
  return (
    <BackendAaContext.Provider value={value}>
      {children}
    </BackendAaContext.Provider>
  );
}

export function useBackendAa(): BackendAaContextValue {
  const value = useContext(BackendAaContext);
  if (!value) {
    throw new Error("Backend AA context is unavailable");
  }
  return value;
}
