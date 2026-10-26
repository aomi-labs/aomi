"use client";

import { useState } from "react";
import { Plug, Wallet } from "lucide-react";
import type { AomiWalletFamily } from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { Segmented } from "@/ui/aomi/segmented";
import {
  SheetAlert,
  SheetHeader,
  WaitingButton,
} from "@/wallet/picker/sheet-parts";
import { useShellTransport } from "@/account/transport";
import { FamilyLabel } from "./family-label";
import { useRefreshWallets } from "./use-refresh-wallets";

/** Which addresses the new wallet gets; a segmented choice, so never none. */
type Chains = "both" | AomiWalletFamily;

const CHAIN_OPTIONS = [
  { value: "both", label: <FamilyLabel family="both" /> },
  { value: "evm", label: <FamilyLabel family="evm" /> },
  { value: "svm", label: <FamilyLabel family="svm" /> },
] as const;

const FAMILIES: Record<Chains, AomiWalletFamily[]> = {
  both: ["evm", "svm"],
  evm: ["evm"],
  svm: ["svm"],
};

const ADDRESSES: Record<Chains, string> = {
  both: "You get one EVM address (the same on every EVM network we support) and one SVM address.",
  evm: "You get one EVM address, the same on every EVM network we support.",
  svm: "You get one SVM address.",
};

/**
 * The "New agent wallet" sheet: a name and its chains (EVM, SVM or both),
 * then those addresses at once. No app choice; apps create and name their own
 * wallets when they need one.
 */
export function NewAgentWalletStep({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose: () => void;
}) {
  const { client } = useShellTransport();
  const refresh = useRefreshWallets();
  const [name, setName] = useState("Agent wallet");
  const [chains, setChains] = useState<Chains>("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.account.wallets.createAgentWallet({
        name: trimmed,
        families: FAMILIES[chains],
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
        <div className="flex flex-col gap-1.5">
          <span className="type-meta text-aomi-fg font-medium">Chains</span>
          <Segmented
            label="Chains"
            fullWidth
            value={chains}
            onChange={setChains}
            options={CHAIN_OPTIONS}
            disabled={busy}
          />
        </div>
        <p className="type-meta text-aomi-muted flex items-start gap-2">
          <Wallet className="mt-px size-3.5 shrink-0" />
          {ADDRESSES[chains]} Add gas before the first trade.
        </p>
        <p className="type-meta text-aomi-muted flex items-start gap-2">
          <Plug className="mt-px size-3.5 shrink-0" />
          Every connection sees it and trades from it in its lane; set lanes in
          Connections.
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
