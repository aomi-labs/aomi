"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Lock } from "lucide-react";
import type {
  AomiClient,
  AomiConnectionWalletsUpdate,
  AomiLane,
} from "@aomi-labs/client";
import { titleCase } from "@/account/account-management/controls";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import { AppLabel } from "@/account/account-management/labels";
import { WalletView, type WalletViewRow } from "./wallet-view";
import { knownLanes, lanesOf, useWalletRows } from "./use-wallet-rows";

/**
 * What a sign-in page writes once access is granted: `ready` once the
 * wallets have loaded (its button waits for it), and the one bound save, or
 * null when nothing changes (or the list could not be read, so nothing is
 * touched).
 */
export type ConsentWalletsState = {
  ready: boolean;
  update: AomiConnectionWalletsUpdate | null;
};

export type ConsentWalletsProps = {
  /** A portal-session client. */
  client: AomiClient;
  /** The connection being set up, e.g. `oauth:<client id>`; its lanes pre-fill. */
  connectionKey?: string;
  /** Its name, for "Ask in <name>". */
  name: string;
  /** The lane on wallets the server has none for yet (default: Ask on Aomi). */
  startLane?: AomiLane;
  /** The app an app-locked client is for (its MCP path names it). */
  app?: string;
  /** The link asked for `mode=ask`: every trade waits for approval. */
  askOnly?: boolean;
  onChange: (state: ConsentWalletsState) => void;
};

/**
 * The wallet view on a sign-in page (consent, the terminal, a Telegram link):
 * every wallet of the account with the lane this connection will have on
 * each agent wallet, pre-filled from what the server says it has, so signing
 * in again keeps it. An app-locked client also gets the app's wallet, made on
 * approval.
 */
export function ConsentWallets({
  client,
  connectionKey,
  name,
  startLane = "portal",
  app,
  askOnly = false,
  onChange,
}: ConsentWalletsProps) {
  const { rows, agents, failed } = useWalletRows(client);
  const start = askOnly ? "portal" : startLane;
  // What the server holds; a connection it doesn't know yet holds nothing,
  // so its shown lanes are written.
  const known = useMemo(
    () => (agents ? knownLanes(agents, connectionKey) : null),
    [agents, connectionKey],
  );
  const current = useMemo(
    () => (agents ? lanesOf(agents, connectionKey, start) : null),
    [agents, connectionKey, start],
  );
  const appWallet = app
    ? agents?.find(
        (wallet) => wallet.app?.name === app && wallet.archived_at === null,
      )
    : undefined;
  const pending = app && agents && !appWallet ? `app:${app}` : null;
  // Only what the user changed; the rest follows the server.
  const [picked, setPicked] = useState<Record<string, AomiLane>>({});
  const lanes = useMemo(
    () => ({
      ...current,
      ...(pending ? { [pending]: start } : {}),
      ...picked,
    }),
    [current, pending, picked, start],
  );

  const state = useMemo<ConsentWalletsState>(() => {
    if (failed) return { ready: true, update: null };
    if (!agents || !known) return { ready: false, update: null };
    const wallets = agents.map((wallet) => ({
      id: wallet.id,
      lane: lanes[wallet.id] ?? "portal",
    }));
    const changed = wallets.some((entry) => entry.lane !== known[entry.id]);
    if (!changed && !app && !askOnly) return { ready: true, update: null };
    return {
      ready: true,
      update: {
        wallets,
        ...(app
          ? {
              application: app,
              ...(pending
                ? { new_app_wallet: { lane: lanes[pending] ?? "portal" } }
                : {}),
            }
          : {}),
        ...(askOnly ? { ask_only: true } : {}),
      },
    };
  }, [agents, app, askOnly, failed, known, lanes, pending]);
  useEffect(() => onChange(state), [onChange, state]);

  if (!rows) return null;
  const label = app ? titleCase(app) : null;
  const shown: WalletViewRow[] = pending
    ? [
        {
          id: pending,
          name: label!,
          kind: "agent",
          brand: AGENT_WALLET,
          addresses: [],
          pending: (
            <>
              Created on approval ·{" "}
              <AppLabel app={{ name: app!, label: label! }} />
            </>
          ),
        },
        ...rows,
      ]
    : rows;
  return (
    <div className="flex w-full flex-col gap-2">
      <WalletView
        rows={shown}
        client={name}
        lanes={lanes}
        askOnly={askOnly}
        detail={`${name} sees all`}
        onLane={(row, lane) =>
          setPicked((previous) => ({ ...previous, [row.id]: lane }))
        }
      />
      {askOnly ? (
        <p className="type-meta text-aomi-muted flex items-start gap-1.5">
          <Lock className="mt-px size-3.5 shrink-0" />
          This link asks you to approve every trade on Aomi. You can change that
          later in Settings → Connections.
        </p>
      ) : (
        <p className="type-meta text-aomi-muted flex items-start gap-1.5">
          <Check className="mt-px size-3.5 shrink-0" />
          Seeing a wallet never spends from it. Trades from sign-in wallets are
          signed in that wallet.
        </p>
      )}
    </div>
  );
}
