"use client";

import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { AccountTransport } from "@aomi-labs/client";
import type {
  ConsentWalletsProps,
  ConsentWalletsState,
} from "./consent-wallets";

export type {
  ConsentWalletsProps,
  ConsentWalletsState,
} from "./consent-wallets";

// Only the sign-in pages show it, so it loads only there.
const Wallets = lazy(() =>
  import("./consent-wallets").then((module) => ({
    default: module.ConsentWallets,
  })),
);

/** The wallet view of a sign-in page; see `consent-wallets.tsx`. */
export function ConsentWallets(props: ConsentWalletsProps) {
  return (
    <Suspense fallback={null}>
      <Wallets {...props} />
    </Suspense>
  );
}

/**
 * A sign-in page's lanes: hand `onChange` to `ConsentWallets`, keep its
 * button off until `ready`, and `save` the connection's lanes once access is
 * granted. Nothing is written when nothing changed; a failed write leaves
 * the connection on its default lanes.
 */
export function useConsentLanes(client: { account: AccountTransport }) {
  const state = useRef<ConsentWalletsState>({ ready: false, update: null });
  const [ready, setReady] = useState(false);
  const onChange = useCallback((next: ConsentWalletsState) => {
    state.current = next;
    setReady(next.ready);
  }, []);
  const save = useCallback(
    async (key: string): Promise<boolean> => {
      const update = state.current.update;
      if (!update) return true;
      return client.account.connections.setConnectionWallets(key, update).then(
        () => true,
        () => false,
      );
    },
    [client],
  );
  return { onChange, ready, save };
}
