"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSettingsSessionId } from "./settings-api";
import {
  Aomi,
  createScopedStorage,
  type GetAccountBearer,
  type ScopedStorage,
} from "@aomi-labs/client";
import { useAomiDisplayCache } from "@aomi-labs/react";
import { useWidgetStorage } from "../lib/widget-storage";

/**
 * The account shell's one `Aomi`: the configured Portal origin and, embedded,
 * the wallet credential. Public reads (catalogs, an App key lookup) go
 * credential-free and never ask for that credential.
 */
export function createShellTransport(
  baseUrl = "",
  getBearer?: GetAccountBearer,
  storage: ScopedStorage = createScopedStorage({ backendUrl: baseUrl }),
) {
  const origin = baseUrl.replace(/\/+$/, "");
  const aomi = new Aomi({
    baseUrl: origin,
    fetch: (input, init) =>
      globalThis.fetch(input, {
        ...init,
        credentials: origin ? "omit" : "same-origin",
        cache: "no-store",
      }),
    getAccountBearer: getBearer
      ? Object.assign(
          (options?: Parameters<GetAccountBearer>[0]) => getBearer(options),
          { required: true },
        )
      : undefined,
  });
  return {
    aomi,
    /** The Aomi origin this widget talks to; empty when same-origin. */
    baseUrl: origin,
    embedded: Boolean(origin),
    themeRoot: null as HTMLElement | null,
    storage,
    /** The thread id the backend's settings routes are scoped to. */
    settingsThread: () => getSettingsSessionId(storage),
  };
}
export type ShellTransport = ReturnType<typeof createShellTransport>;
const defaultTransport = createShellTransport();
const ShellTransportContext = createContext(defaultTransport);
export const useShellTransport = () => useContext(ShellTransportContext);
/** The account shell's `Aomi`. */
export const useShellAomi = () => useContext(ShellTransportContext).aomi;
/** The runtime's `Aomi` inside a runtime (its guest or session), else the shell's. */
export function useAomi(): Aomi {
  const shell = useShellAomi();
  return useAomiDisplayCache()?.aomi ?? shell;
}

export function ShellTransportProvider({
  baseUrl,
  getBearer,
  children,
}: {
  baseUrl: string;
  getBearer?: GetAccountBearer;
  children: ReactNode;
}) {
  const storage = useWidgetStorage();
  const [themeRoot, setThemeRoot] = useState<HTMLDivElement | null>(null);
  const api = useMemo(
    () => createShellTransport(baseUrl, getBearer, storage),
    [baseUrl, getBearer, storage],
  );
  const transport = useMemo(() => ({ ...api, themeRoot }), [api, themeRoot]);
  return (
    <ShellTransportContext.Provider value={transport}>
      <div ref={setThemeRoot} style={{ display: "contents" }}>
        {children}
      </div>
    </ShellTransportContext.Provider>
  );
}
