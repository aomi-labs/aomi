"use client";

import { useState } from "react";
import { Plug, Wallet } from "lucide-react";
import { AomiButton } from "@/ui/aomi/button";
import {
  SheetAlert,
  SheetHeader,
  WaitingButton,
} from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import { useRefreshWallets } from "./use-refresh-wallets";

/**
 * The "New agent wallet" sheet: a name, then both addresses at once. No app
 * choice; apps create and name their own wallets when they need one.
 */
export function NewAgentWalletStep({
  connectionKey,
  onDone,
  onClose,
}: {
  /** Also let this connection use it (Ask), e.g. the chat that asked. */
  connectionKey?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { client } = useShellTransport();
  const refresh = useRefreshWallets();
  const [name, setName] = useState("Agent wallet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.account.wallets.createAgentWallet({
        name: trimmed,
        ...(connectionKey ? { connection_key: connectionKey } : {}),
      });
      await refresh();
      onDone();
    } catch (cause) {
      setBusy(false);
      setError(
        (cause as { code?: string }).code === "portal_session_required"
          ? "Create agent wallets on Aomi itself."
          : "Couldn’t create the wallet. Try again.",
      );
    }
  };

  return (
    <>
      <SheetHeader
        title="New agent wallet"
        description="Aomi signs with it when a connection is allowed to"
        onClose={onClose}
      />
      <form
        className="flex flex-col gap-4 px-5 pb-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed && !busy) void create();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="type-meta text-aomi-fg font-medium">Name</span>
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.target.select()}
            className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted type-control rounded-control h-10 border px-3 outline-none transition-colors"
          />
        </label>
        <p className="type-meta text-aomi-muted flex items-start gap-2">
          <Wallet className="mt-px size-3.5 shrink-0" />
          You get one EVM address (the same on every EVM network we support) and
          one Solana address. Add gas before the first trade.
        </p>
        <p className="type-meta text-aomi-muted flex items-start gap-2">
          <Plug className="mt-px size-3.5 shrink-0" />
          {connectionKey
            ? "This chat can use it right away and asks before each trade."
            : "No connection can use it until you allow one. Add it in Connections, or when a client asks."}
        </p>
        {error ? <SheetAlert>{error}</SheetAlert> : null}
        {busy ? (
          <WaitingButton>Creating wallet…</WaitingButton>
        ) : (
          <AomiButton
            type="submit"
            variant="primary"
            className="h-10 w-full"
            disabled={!trimmed}
          >
            Create wallet
          </AomiButton>
        )}
      </form>
    </>
  );
}
