"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Lock } from "lucide-react";
import type {
  AomiAgentWallet,
  AomiClient,
  AomiConnectionWalletsUpdate,
} from "@aomi-labs/client";
import { SectionHeader } from "@/ui/aomi/section-header";
import { titleCase } from "@/account/account-management/controls";
import type { PairMode } from "./connection-pairs";
import { AppLabel } from "@/account/account-management/labels";
import { WalletAccessList, type WalletAccess } from "./wallet-access-list";

/**
 * What consent writes once the grant is made: `ready` once the wallets have
 * loaded (Allow waits for it), and the one bound save, or null when there is
 * nothing to change (or the list could not be read, so nothing is touched).
 */
export type ConsentWalletsState = {
  ready: boolean;
  update: AomiConnectionWalletsUpdate | null;
};

export type ConsentWalletsProps = {
  /** A portal-session client. */
  client: AomiClient;
  /** The connection being consented, `oauth:<client id>`; its access pre-fills. */
  connectionKey?: string;
  /** The app an app-locked client is for (its MCP path names it). */
  app?: string;
  /** The link asked for `mode=ask`: every trade waits for approval. */
  askOnly?: boolean;
  onChange: (state: ConsentWalletsState) => void;
};

type Loaded = {
  /** Live wallets, shown. */
  wallets: AomiAgentWallet[];
  /** The connection's current access, archived wallets' included. */
  current: WalletAccess[];
};

/**
 * The agent wallet part of OAuth consent, pre-filled from the access the
 * connection already has, so consenting again keeps it. An open client may
 * tick any agent wallets; an app-locked one trades from a wallet the app
 * made, created on first use. Ask unless Instant is picked, and never Instant
 * on an Ask-only link.
 */
export function ConsentWallets({
  client,
  connectionKey,
  app,
  askOnly = false,
  onChange,
}: ConsentWalletsProps) {
  const [loaded, setLoaded] = useState<Loaded | null | "failed">(null);
  const [access, setAccess] = useState<WalletAccess[]>([]);
  const [mode, setMode] = useState<PairMode>("ask");

  useEffect(() => {
    let live = true;
    client.account.wallets.agentWallets().then(
      (list) => {
        if (!live) return;
        const current = list.wallets.flatMap((wallet) =>
          wallet.connections
            .filter((connection) => connection.key === connectionKey)
            .map((connection) => ({
              id: wallet.id,
              instant: connection.instant,
            })),
        );
        const wallets = list.wallets.filter(
          (wallet) => wallet.archived_at === null,
        );
        setLoaded({ wallets, current });
        setAccess(
          current.filter((pair) => wallets.some((w) => w.id === pair.id)),
        );
        const made = wallets.find((wallet) => wallet.app?.name === app);
        if (current.some((pair) => pair.id === made?.id && pair.instant))
          setMode("instant");
      },
      () => live && setLoaded("failed"),
    );
    return () => {
      live = false;
    };
  }, [client, connectionKey, app]);

  const wallets = loaded && loaded !== "failed" ? loaded.wallets : null;
  const appWallet = app
    ? wallets?.find((wallet) => wallet.app?.name === app)
    : undefined;
  const state = useMemo<ConsentWalletsState>(() => {
    if (loaded === null) return { ready: false, update: null };
    if (loaded === "failed") return { ready: true, update: null };
    const instant = (value: boolean) => value && !askOnly;
    const shown = app
      ? appWallet
        ? [{ id: appWallet.id, instant: instant(mode === "instant") }]
        : []
      : access.map((pair) => ({ ...pair, instant: instant(pair.instant) }));
    // Access to wallets not shown (archived, or not the app's) stays.
    const visible = new Set(
      app ? [appWallet?.id] : loaded.wallets.map((wallet) => wallet.id),
    );
    const kept = loaded.current.filter((pair) => !visible.has(pair.id));
    const pairs = [...shown, ...kept];
    const same = (a: WalletAccess[], b: WalletAccess[]) =>
      a.length === b.length &&
      a.every((pair) =>
        b.some(
          (other) => other.id === pair.id && other.instant === pair.instant,
        ),
      );
    // The app's wallet is still to be made, or the link caps it at Ask: save.
    if (!(app && !appWallet) && !askOnly && same(pairs, loaded.current))
      return { ready: true, update: null };
    return {
      ready: true,
      update: {
        wallets: pairs,
        // The mode picked for the app's wallet, also when it is created now.
        ...(app
          ? {
              application: app,
              new_app_wallet: { instant: instant(mode === "instant") },
            }
          : {}),
        ...(askOnly ? { ask_only: true } : {}),
      },
    };
  }, [access, app, appWallet, askOnly, loaded, mode]);
  useEffect(() => onChange(state), [onChange, state]);

  if (!wallets) return null;

  if (app) {
    const label = appWallet?.app?.label ?? titleCase(app);
    // Until the app makes it, its wallet is named after the app.
    const row: AomiAgentWallet = appWallet ?? {
      id: `app:${app}`,
      name: label,
      paused: false,
      archived_at: null,
      app: { id: 0, name: app, label },
      last_used_at: null,
      created_at: 0,
      addresses: [],
      connections: [],
    };
    return (
      <section className="flex w-full flex-col gap-2">
        <SectionHeader
          title="Trade from"
          detail={`${label} asks for its wallet`}
        />
        <WalletAccessList
          wallets={[row]}
          access={[{ id: row.id, instant: mode === "instant" }]}
          askOnly={askOnly}
          fixed
          // A new wallet has no address yet: it says so, with the app's label.
          describe={
            appWallet
              ? undefined
              : () => (
                  <>
                    Created on approval ·{" "}
                    <AppLabel app={{ name: app, label }} />
                  </>
                )
          }
          onMode={(_, next) => setMode(next)}
        />
        {askOnly ? (
          <p className="type-meta text-aomi-muted flex items-start gap-1.5">
            <Lock className="mt-px size-3.5 shrink-0" />
            This link requires approval for every trade. You can change wallets
            later in Settings → Connections.
          </p>
        ) : null}
      </section>
    );
  }

  if (!wallets.length) return null;
  return (
    <section className="flex w-full flex-col gap-2">
      <SectionHeader title="Agent wallets it may use" detail="optional" />
      <WalletAccessList
        wallets={wallets}
        access={access}
        askOnly={askOnly}
        onTick={(wallet, ticked) =>
          setAccess((current) =>
            ticked
              ? [...current, { id: wallet.id, instant: false }]
              : current.filter((pair) => pair.id !== wallet.id),
          )
        }
        onMode={(wallet, next) =>
          setAccess((current) =>
            current.map((pair) =>
              pair.id === wallet.id
                ? { ...pair, instant: next === "instant" }
                : pair,
            ),
          )
        }
      />
      <p className="type-meta text-aomi-muted flex items-start gap-1.5">
        <Check className="mt-px size-3.5 shrink-0" />
        It can always chat and read your wallets. Trades from your sign-in
        wallets wait for you to sign.
      </p>
    </section>
  );
}
