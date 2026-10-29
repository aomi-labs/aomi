"use client";
import { useState } from "react";
import type { CommitView } from "@aomi-labs/client";
import { shortAddress } from "@aomi-labs/client";
import { ArrowLeftRight } from "lucide-react";
import { useAomiWalletKit } from "@/wallet/context";
import { walletKey } from "@/wallet/wallet-utils";
import type { ConnectAction } from "./transaction-review";
import { rowTitle } from "@/account/account-management/wallet-model";

type SignerSwitch = {
  /** The signer is not the active wallet and can be activated here. */
  connect?: ConnectAction;
  /** The signer cannot be activated in this browser: why Submit is off. */
  note?: string;
  /** The last switch failed. */
  error?: string;
};

/**
 * What a review needs when its signer is not the family's active wallet:
 * "Switch to <wallet>" while the wallet kit can activate it, else a line
 * saying what to connect. Switching never submits; the user clicks Submit.
 */
export function useSignerSwitch(
  commit: Pick<CommitView, "signer" | "chain_family"> | undefined,
): SignerSwitch {
  const wallet = useAomiWalletKit();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!commit || !wallet.isReady) return {};
  const family = commit.chain_family === "evm" ? "evm" : "svm";
  const signer = walletKey(family, commit.signer);
  const active =
    family === "evm" ? wallet.identity.address : wallet.identity.svmAddress;
  if (active && walletKey(family, active) === signer) return {};
  const row = wallet.wallets.find((candidate) => candidate.key === signer);
  // An agent wallet signs on the server; it never needs this browser.
  if (row?.kind === "agent") return {};
  const name = row ? rowTitle(row).title : shortAddress(commit.signer);
  // A connected, usable signer that another wallet outranks is only picked;
  // anything else needs a step (install, connect, sign in) the picker owns.
  const switchable =
    row?.connectionId &&
    wallet.activateWallet &&
    (row.state === "ready" ||
      row.state === "guest" ||
      (row.state === "offline" && row.reason === "selection_required"));
  if (!switchable) return { note: `Connect ${name} to submit` };
  return {
    error,
    connect: {
      variant: "primary",
      disabled: busy,
      label: (
        <>
          <ArrowLeftRight />
          Switch to {name}
        </>
      ),
      onClick: () => {
        setBusy(true);
        setError(undefined);
        wallet.activateWallet!(signer)
          .catch((cause: unknown) =>
            setError(
              cause instanceof Error
                ? cause.message
                : "Couldn’t switch wallets",
            ),
          )
          .finally(() => setBusy(false));
      },
    },
  };
}
