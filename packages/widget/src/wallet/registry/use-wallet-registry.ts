"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { WalletRegistryStore, type CommandExecutors } from "./store";
import type { WalletRegistryState } from "./types";

export function useWalletRegistry(opts: {
  executors: CommandExecutors;
  storageKey: string;
}): {
  store: WalletRegistryStore;
  state: WalletRegistryState;
} {
  const executorsRef = useRef(opts.executors);
  useEffect(() => {
    executorsRef.current = opts.executors;
  }, [opts.executors]);

  const store = useMemo(
    () =>
      new WalletRegistryStore({
        executors: {
          wagmiReconnect: (stableIds) =>
            executorsRef.current.wagmiReconnect(stableIds),
          wagmiConnect: (stableId) =>
            executorsRef.current.wagmiConnect(stableId),
          wagmiDisconnect: (uid) => executorsRef.current.wagmiDisconnect(uid),
          providerLogout: () => executorsRef.current.providerLogout(),
        },
        storageKey: opts.storageKey,
        initialNow: Date.now(),
      }),
    [opts.storageKey],
  );
  useEffect(() => () => store.dispose(), [store]);
  const state = useSyncExternalStore(
    (callback) => store.subscribe(callback),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );

  return { store, state };
}
