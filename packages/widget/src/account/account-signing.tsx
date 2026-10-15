"use client";

import { useMemo, useRef, useState } from "react";
import {
  shortAddress,
  type AomiAuthorizationChallenge,
} from "@aomi-labs/client";
import type { SignerChoice, WalletPolicy } from "./types";
import {
  sortWallets,
  walletDisplayName,
  modeLabel,
  modeHintFor,
} from "./account-reconcile";
import { AomiButton } from "@/ui/aomi/button";
import { ConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";

interface LockedWalletsViewProps {
  /** Browser and embedded wallets that are Locked (`signing_mode='denied'`). */
  wallets: WalletPolicy[];
  onPrepare: (
    wallet: WalletPolicy,
    mode: SignerChoice,
  ) => Promise<AomiAuthorizationChallenge>;
  /** Sign the exact reviewed permit. Rejects with a user-facing message. */
  onCommit: (
    wallet: WalletPolicy,
    mode: SignerChoice,
    challenge: AomiAuthorizationChallenge,
  ) => Promise<void>;
  /** Why a target mode can't be signed right now, or null when it can. */
  blockedReason?: (wallet: WalletPolicy, mode: SignerChoice) => string | null;
}

/**
 * Legacy Locked browser and embedded wallets, each with Unlock. Those wallets
 * otherwise ask in the wallet itself and have nothing to set; a Locked one is
 * never unlocked silently. Unlock runs the permit ceremony: prepare, review
 * the exact payload, sign, commit.
 */
export function LockedWalletsView({
  wallets,
  onCommit,
  onPrepare,
  blockedReason,
}: LockedWalletsViewProps) {
  const [drafts, setDrafts] = useState<Record<string, SignerChoice>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{
    wallet: WalletPolicy;
    mode: SignerChoice;
    challenge: AomiAuthorizationChallenge;
  } | null>(null);
  const confirming = useRef(false);

  const run = async (
    id: string,
    action: () => Promise<void>,
  ): Promise<boolean> => {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
    try {
      await action();
      return true;
    } catch (cause) {
      setErrors((e) => ({
        ...e,
        [id]: cause instanceof Error ? cause.message : "Something went wrong",
      }));
      return false;
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[id];
        return next;
      });
    }
  };

  const signingWallets = useMemo(() => sortWallets(wallets), [wallets]);

  const cancelDraft = (id: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  const walletById = (id: string) => wallets.find((w) => w.id === id);

  const choose = (wallet: WalletPolicy, mode: SignerChoice) => {
    if (mode === wallet.desiredMode || confirming.current || confirmation)
      return;
    const blocked = blockedReason?.(wallet, mode) ?? null;
    if (blocked) {
      setErrors((e) => ({ ...e, [wallet.id]: blocked }));
      return;
    }
    setDrafts((d) => ({ ...d, [wallet.id]: mode }));
    // Fetch the permit and open it for review; nothing is signed yet.
    confirming.current = true;
    void run(wallet.id, async () => {
      const challenge = await onPrepare(wallet, mode);
      setConfirmation({ wallet, mode, challenge });
    })
      .then((ok) => {
        if (!ok) cancelDraft(wallet.id);
      })
      .finally(() => {
        confirming.current = false;
      });
  };

  const dismiss = () => {
    if (confirmation) cancelDraft(confirmation.wallet.id);
    setConfirmation(null);
  };

  const commit = async () => {
    if (!confirmation || confirming.current) return;
    const { wallet, mode, challenge } = confirmation;
    confirming.current = true;
    setConfirmation(null);
    try {
      await run(wallet.id, () => {
        const current = walletById(wallet.id);
        if (
          !current ||
          current.authVersion !== wallet.authVersion ||
          current.desiredMode !== wallet.desiredMode
        ) {
          throw new Error(
            "This wallet's policy changed. Review the updated policy before signing.",
          );
        }
        return onCommit(current, mode, challenge);
      });
    } finally {
      cancelDraft(wallet.id);
      confirming.current = false;
    }
  };

  return (
    <>
      <section
        aria-labelledby="locked-wallets-heading"
        className="flex flex-col gap-2"
      >
        <SectionHeader
          id="locked-wallets-heading"
          title="Locked wallets"
          help="Locked before agent wallets: these can't sign. Unlock asks the wallet to sign once; it then asks in the wallet for every transaction."
        />
        <ListGroup>
          {signingWallets.map((wallet) => (
            <ListRow
              key={wallet.id}
              className="min-h-0 py-2.5"
              title={walletDisplayName(wallet)}
              description={
                errors[wallet.id] ? (
                  <span role="alert" className="text-aomi-danger">
                    {errors[wallet.id]}
                  </span>
                ) : (
                  shortAddress(wallet.address)
                )
              }
              descriptionMono={!errors[wallet.id]}
              trailing={
                <AomiButton
                  size="sm"
                  aria-label={`Unlock ${walletDisplayName(wallet)} ${wallet.address}`}
                  disabled={Boolean(busy[wallet.id] || drafts[wallet.id])}
                  onClick={() => choose(wallet, "manual")}
                >
                  {busy[wallet.id] ? "Unlocking…" : "Unlock"}
                </AomiButton>
              }
            />
          ))}
        </ListGroup>
      </section>

      <ConfirmDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
        onConfirm={() => void commit()}
        closeOnConfirm={false}
        title="Confirm signing policy"
        description="Review this wallet’s new permissions before authorizing the change."
        confirmLabel="Sign to approve"
      >
        {confirmation ? (
          <div className="flex flex-col gap-4">
            <div className="border-aomi-border rounded-control border p-3.5">
              <p className="type-row">
                {walletDisplayName(confirmation.wallet)}
              </p>
              <p className="type-address text-aomi-muted mt-1 break-all">
                {confirmation.wallet.address} ·{" "}
                {confirmation.wallet.chain === "evm" ? "EVM" : "SVM"}
              </p>
              <p className="type-row mt-3">
                {modeLabel(confirmation.wallet.desiredMode)} →{" "}
                {modeLabel(confirmation.mode)}
              </p>
              <p className="type-meta text-aomi-muted mt-1">
                {modeHintFor(confirmation.mode)}
              </p>
            </div>
            <div>
              <p className="type-section">
                {confirmation.wallet.chain === "evm"
                  ? "EIP-712 typed data"
                  : "Solana message"}
              </p>
              <pre
                aria-label="Payload to sign"
                className="border-aomi-border bg-aomi-bg type-address rounded-control mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all border p-3"
              >
                {confirmation.wallet.chain === "evm"
                  ? JSON.stringify(confirmation.challenge.typed_data, null, 2)
                  : new TextDecoder().decode(
                      Uint8Array.from(
                        atob(confirmation.challenge.message_base64 ?? ""),
                        (c) => c.charCodeAt(0),
                      ),
                    )}
              </pre>
            </div>
            <p className="type-meta text-aomi-muted">
              Sign the payload above to authorize this policy change. The
              backend verifies your wallet signature before applying it. An
              embedded wallet may sign without another popup. No funds will be
              sent.
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
