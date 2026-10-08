"use client";

import type { SignerMode, WalletPolicy } from "@/account/types";
import {
  modeLabel,
  reconcile,
  signingChoicesFor,
  unavailableReason,
  walletDisplayName,
  walletMarkKey,
  walletNameToMarkKey,
} from "@/account/account-reconcile";
import { useAomiWalletKit } from "./context";
import { WalletProviderAvatar } from "./wallet-brands";
import { Loader2 } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { ListRow } from "@/ui/aomi/list-group";
import { Segmented } from "@/ui/aomi/segmented";
import { shortAddress } from "@aomi-labs/client";

interface WalletPolicyRowProps {
  wallet: WalletPolicy;
  /** The mode being reviewed or signed, shown until it commits or is dropped. */
  draft?: SignerMode;
  busy: boolean;
  error?: string;
  onSelect: (mode: SignerMode) => void;
}

/** "0xda65…3cf0 · EVM": the address line under a wallet's name. */
export function walletAddressLine(
  wallet: Pick<WalletPolicy, "address" | "chain">,
) {
  return `${shortAddress(wallet.address)} · ${wallet.chain === "evm" ? "EVM" : "SVM"}`;
}

/**
 * The quiet status under a row: persistent delegation or drift state only. An
 * in-flight change shows as the drafted segment plus a spinner, not a line.
 */
function statusLine(
  wallet: WalletPolicy,
  choices: readonly SignerMode[],
): { text: string; danger?: boolean } | null {
  if (wallet.desiredMode === "auto") {
    const recon = reconcile(wallet);
    return recon.status === "drifted"
      ? { text: "Automatic signing · Delegation expired", danger: true }
      : {
          text: `Automatic signing · Delegation valid to ${wallet.delegationExpiresLabel ?? "—"}`,
        };
  }
  if (!choices.includes(wallet.desiredMode)) {
    return {
      text: `${modeLabel(wallet.desiredMode)} isn't available for this wallet. Choose another mode.`,
    };
  }
  return null;
}

/** One signable address with its Ask me / Auto / Locked choice. */
export function WalletPolicyRow({
  wallet,
  draft,
  busy,
  error,
  onSelect,
}: WalletPolicyRowProps) {
  const choices = signingChoicesFor(wallet);
  const status = statusLine(wallet, choices);
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
  // Every row shows the same three slots so the controls line up; a mode
  // this wallet can't hold stays visible but disabled.
  const slots: SignerMode[] = wallet.providerManaged
    ? choices
    : ["manual", "client_auto", "denied"];

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
              onChange={onSelect}
              options={slots.map((mode) => {
                const available = choices.includes(mode);
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
            <p
              className={cn(
                "type-meta",
                status.danger ? "text-aomi-danger" : "text-aomi-muted",
              )}
            >
              {status.text}
            </p>
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
