"use client";

import { useState } from "react";
import {
  normalizeSolanaCluster,
  shortAddress,
  type AomiRulesEnforcement,
  type AomiRulesAction,
  type AomiWalletRules,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import { useAomiWalletKit } from "@/wallet/context";
import type { AomiWalletKit } from "@/wallet/types";
import { isExpectedWalletCancellation } from "@/wallet/picker/wallet-cancellation";
import { connectedAddress, type RulesClient } from "./rule-change-card";
import { rulesErrorCode, rulesFailure } from "./rules-model";

const FAMILY = { evm: "an EVM", svm: "a Solana" };

// The wallet and the backend read the chain through different nodes, so a
// confirm can come before the backend's node shows the transaction.
async function settled<T>(confirm: () => Promise<T>, delayMs: number) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await confirm();
    } catch (cause) {
      if (attempt >= 5 || rulesErrorCode(cause) !== "chain_not_settled")
        throw cause;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Have the owner's wallet do what the step for `entry` asked. An action for
 * another network than the entry's, or one this wallet has no name for, is
 * refused: it is never sent to a default network.
 */
async function act(
  kit: AomiWalletKit,
  entry: AomiRulesEnforcement,
  action: AomiRulesAction,
  description: string,
): Promise<void> {
  const execute = kit.signAndSendSolanaTransaction ?? kit.sendSolanaTransaction;
  const cluster = normalizeSolanaCluster(action.network);
  if (
    entry.signer.family !== "svm" ||
    action.network !== entry.network ||
    !cluster ||
    !execute
  )
    throw new Error("This wallet can't sign that transaction.");
  await execute({ unsignedTx: action.unsigned_base64, description, cluster });
}

/**
 * Wallet › Manage › Rules: one on-chain provider that can check the same
 * rules a second time, as the last row of the rule list. Which rules it
 * stands behind is on each rule's own label; this row is where the owner
 * puts the rules on chain, updates them there or takes them off. It is the
 * same for every provider: a line of text and one button, or two. There is nothing to fill
 * in. The backend derives the policy from the rules, and the owner's own
 * wallet signs it.
 */
export function RuleEnforcement({
  client,
  walletId,
  revision,
  entry,
  onRules,
  onStale,
  retryDelayMs = 2_000,
}: {
  client: RulesClient;
  walletId: string;
  revision: number;
  entry: AomiRulesEnforcement;
  /** The rules as the backend read them after a step. */
  onRules: (rules: AomiWalletRules) => void;
  /** A step failed, so what is shown may be out of date. */
  onStale: () => void;
  retryDelayMs?: number;
}) {
  const kit = useAomiWalletKit();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { family } = entry.signer;
  const connected = connectedAddress(kit, family);
  // Once the rules are on chain, only the wallet that put them there signs.
  const owner = entry.signer.address ?? connected;
  const canSign = Boolean(connected) && connected === owner;

  const run = async (remove: boolean) => {
    if (busy || !owner) return;
    setBusy(true);
    setError(null);
    const request = {
      network: entry.network,
      revision,
      owner,
      ...(remove ? { remove } : {}),
    };
    try {
      const action = await client.account.rules.prepareEnforcement(
        walletId,
        entry.provider,
        request,
      );
      if (action)
        await act(
          kit,
          entry,
          action,
          remove ? "Remove rules from chain" : "Enforce rules on chain",
        );
      onRules(
        await settled(
          () =>
            client.account.rules.confirmEnforcement(
              walletId,
              entry.provider,
              request,
            ),
          retryDelayMs,
        ),
      );
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "";
      setError(
        isExpectedWalletCancellation(cause)
          ? "Signature declined. Nothing changed."
          : rulesFailure(cause, raw || "That didn’t go through. Try again."),
      );
      onStale();
    } finally {
      setBusy(false);
    }
  };

  const bound = entry.state !== "off";
  // Nothing is on chain and nothing can go there yet: no row.
  if (!bound && !entry.ready) return null;
  return (
    <div
      data-rule-enforcement={entry.provider}
      data-state={entry.state}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-3"
    >
      <p className="type-meta text-aomi-muted min-w-40 flex-1">
        {entry.state === "on"
          ? `${entry.name} also enforces the rules marked with it, on chain. Your wallet is its only admin.`
          : (entry.note ??
            (bound
              ? `${entry.name} holds older rules.`
              : `${entry.name} can also enforce these rules on chain. Your wallet signs once and stays its only admin.`))}
        {canSign
          ? null
          : ` Connect ${
              owner && owner !== connected
                ? shortAddress(owner)
                : `${FAMILY[family]} wallet`
            } to change this.`}
      </p>
      <span className="flex items-center gap-1">
        {bound ? (
          <AomiButton
            variant="ghost"
            size="sm"
            disabled={busy || !canSign}
            onClick={() => void run(true)}
          >
            Remove from {entry.name}
          </AomiButton>
        ) : null}
        {entry.ready ? (
          <AomiButton
            size="sm"
            disabled={busy || !canSign}
            onClick={() => void run(false)}
          >
            {bound ? `Update ${entry.name}` : `+ ${entry.name}`}
          </AomiButton>
        ) : null}
      </span>
      {error ? (
        <div className="w-full">
          <SheetAlert>{error}</SheetAlert>
        </div>
      ) : null}
    </div>
  );
}
