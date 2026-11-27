"use client";

import { lazy, Suspense, useCallback, useRef, useState } from "react";
import {
  AomiApiError,
  POLICY_ERROR_CODES,
  type AccountTransport,
} from "@aomi-labs/client";
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
 * A sign-in page's ask modes: hand `onChange` to `ConsentWallets`, keep its
 * button off until `ready`, and `save` the connection's ask modes once access is
 * granted. Nothing is written when nothing changed; a failed write leaves
 * the connection on its default ask modes. `note` is a line to show with the
 * result: the refusal's code, or the Instant left for an admin wallet to sign.
 *
 * Instant on a wallet whose admin is a wallet is refused with 403
 * `rules_signature_required`, for the whole write. As in Settings, those
 * wallets are then written on Ask and their Instant filed as a policy change.
 */
export function useConsentAskModes(client: { account: AccountTransport }) {
  const state = useRef<ConsentWalletsState>({ ready: false, update: null });
  const [ready, setReady] = useState(false);
  const onChange = useCallback((next: ConsentWalletsState) => {
    state.current = next;
    setReady(next.ready);
  }, []);
  const save = useCallback(
    async (key: string): Promise<{ saved: boolean; note?: string }> => {
      const { update, instant = [] } = state.current;
      if (!update) return { saved: true };
      const { connections, policy } = client.account;
      const write = (held: string[] = []) =>
        connections
          .setConnectionWallets(key, {
            ...update,
            wallets: update.wallets.map((entry) =>
              held.includes(entry.id)
                ? { ...entry, ask_mode: "ask_aomi" }
                : entry,
            ),
          })
          .then(
            () => null,
            (error: unknown) =>
              error instanceof AomiApiError ? error.code : "unknown",
          );
      const refused = await write();
      if (refused !== POLICY_ERROR_CODES.signatureRequired)
        return refused ? { saved: false, note: refused } : { saved: true };
      // A wallet whose rules can't be read is held too, so the write lands.
      const held = (
        await Promise.all(
          instant.map((id) =>
            policy.get(id).then(
              (rules) => ({ id, rules }),
              () => ({ id, rules: null }),
            ),
          ),
        )
      ).filter(({ rules }) => rules?.admin.kind !== "aomi_managed");
      const again = await write(held.map(({ id }) => id));
      if (again) return { saved: false, note: again };
      const filed = await Promise.all(
        held.map(({ id }) => policy.change(id, { instant: [key] })),
      ).then(
        () => true,
        () => false,
      );
      const names = held
        .map(({ id, rules }) => `"${rules?.wallet_name ?? id}"`)
        .join(", ");
      return {
        saved: true,
        note: `Instant on ${names} needs its admin wallet to sign, so it asks for now. ${filed ? "Approve it in Settings → Policies." : "Turn it on in Settings → Connections."}`,
      };
    },
    [client],
  );
  return { onChange, ready, save };
}
