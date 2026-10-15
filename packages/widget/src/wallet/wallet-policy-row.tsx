"use client";

import type { SignerChoice, SignerMode, WalletPolicy } from "@/account/types";
import {
  modeLabel,
  signingChoicesFor,
  unavailableReason,
  walletDisplayName,
  walletMarkKey,
  walletNameToMarkKey,
} from "@/account/account-reconcile";
import { useAomiWalletKit } from "./context";
import { WalletProviderAvatar } from "./wallet-brands";
import { Loader2 } from "lucide-react";
import { ListRow } from "@/ui/aomi/list-group";
import { Segmented } from "@/ui/aomi/segmented";
import { shortAddress } from "@aomi-labs/client";

interface WalletPolicyRowProps {
  wallet: WalletPolicy;
  /** The mode being reviewed or signed, shown until it commits or is dropped. */
  draft?: SignerChoice;
  busy: boolean;
  error?: string;
  onSelect: (mode: SignerChoice) => void;
}

/** "0xda65…3cf0 · EVM": the address line under a wallet's name. */
export function walletAddressLine(
  wallet: Pick<WalletPolicy, "address" | "chain">,
) {
  return `${shortAddress(wallet.address)} · ${wallet.chain === "evm" ? "EVM" : "SVM"}`;
}

/**
 * The quiet status under a row, only when the saved mode is not one this row
 * offers. An in-flight change shows as the drafted segment plus a spinner.
 * An agent wallet already on Automatic shows it as its selected slot instead.
 */
function statusLine(
  wallet: WalletPolicy,
  slots: readonly SignerMode[],
): { text: string } | null {
  if (slots.includes(wallet.desiredMode)) return null;
  return {
    text: `${modeLabel(wallet.desiredMode)} isn't available for this wallet. Choose another mode.`,
  };
}

/** One signable address with its Ask me / Locked choice. */
export function WalletPolicyRow({
  wallet,
  draft,
  busy,
  error,
  onSelect,
}: WalletPolicyRowProps) {
  const choices: readonly SignerMode[] = signingChoicesFor(wallet);
  // Every row shows the same slots so the controls line up; a mode this
  // wallet can't move to stays visible but disabled. An agent wallet keeps a
  // read-only Automatic slot so its current mode stays visible.
  const slots: SignerMode[] = wallet.providerManaged
    ? ["auto", "denied"]
    : ["manual", "denied"];
  const status = statusLine(wallet, slots);
  // A SIWE/SIWS wallet carries no brand on the wire; borrow the connector's
  // name (Rabby, MetaMask) when this browser knows the address.
  const connector = useAomiWalletKit().wallets.find(
    (row) => row.address.toLowerCase() === wallet.address.toLowerCase(),
  );
  const generic = wallet.linkedVia === "siwe" || wallet.linkedVia === "siws";
  const name =
    generic && connector?.walletName
      ? connector.walletName
      : walletDisplayName(wallet);
  const markKey =
    walletMarkKey(wallet) ??
    (generic ? walletNameToMarkKey(connector?.walletName) : null);
  return (
    <div id={`wallet-${wallet.id}`}>
      <ListRow
        leading={<WalletProviderAvatar markKey={markKey} size={18} />}
        title={name}
        description={walletAddressLine(wallet)}
        descriptionMono
        trailing={
          <>
            {busy ? (
              <Loader2
                aria-label="Saving"
                className="text-aomi-muted size-4 animate-spin"
              />
            ) : null}
            <Segmented
              size="sm"
              label={`Signing for ${name} ${wallet.address}`}
              value={draft ?? wallet.desiredMode}
              onChange={(mode) => {
                if (mode !== "auto") onSelect(mode);
              }}
              options={slots.map((mode) => {
                // The saved mode stays selectable so it renders as selected;
                // choosing it again is a no-op.
                const available =
                  choices.includes(mode) || mode === wallet.desiredMode;
                return {
                  value: mode,
                  disabled: !available,
                  label: available ? (
                    modeLabel(mode)
                  ) : (
                    <span title={unavailableReason(wallet, mode)}>
                      {modeLabel(mode)}
                    </span>
                  ),
                };
              })}
            />
          </>
        }
      />
      {status || error ? (
        <div className="-mt-1.5 flex flex-col gap-0.5 pb-3 pl-[58px] pr-3.5">
          {status ? (
            <p className="type-meta text-aomi-muted">{status.text}</p>
          ) : null}
          {error ? (
            <p role="alert" className="type-meta text-aomi-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
