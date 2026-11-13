"use client";

import { useState } from "react";
import {
  normalizeSolanaCluster,
  shortAddress,
  type AomiRulesEnforcement,
  type AomiRulesTransaction,
  type AomiWalletRules,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { ListRow } from "@/ui/aomi/list-group";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import { useAomiWalletKit } from "@/wallet/context";
import type { RulesClient } from "./rule-change-card";
import { rulesErrorCode, rulesFailure } from "./rules-model";

/** The providers that check a rule on chain now, by name. */
export const enforcers = (
  enforcement: readonly AomiRulesEnforcement[],
  covers: (entry: AomiRulesEnforcement["covers"]) => boolean = () => true,
): string[] =>
  enforcement
    .filter((entry) => entry.state !== "off" && covers(entry.covers))
    .map((entry) => entry.name);

const STATE = {
  off: "Off",
  on: "On",
  behind: "Behind your rules",
  unverified: "Unverified",
};
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
 * Wallet › Manage › Rules: one on-chain provider that can check the same
 * rules a second time. The row is the same for every provider: its name and
 * state, what is wrong if anything, and one button. There is nothing to fill
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
  const connected =
    family === "svm" ? kit.identity.svmAddress : kit.identity.address;
  // Once the rules are on chain, only the wallet that put them there signs.
  const owner = entry.signer.address ?? connected;
  const canSign = Boolean(connected) && connected === owner;

  const send = async (transaction: AomiRulesTransaction, label: string) => {
    const execute =
      kit.signAndSendSolanaTransaction ?? kit.sendSolanaTransaction;
    if (transaction.family !== "svm" || !execute)
      throw new Error("This wallet can't sign that transaction.");
    const { signature } = await execute({
      unsignedTx: transaction.unsigned_base64,
      description: label,
      cluster: normalizeSolanaCluster(transaction.network) ?? "solana:mainnet",
    });
    return signature;
  };

  const run = async (remove: boolean) => {
    if (busy || !owner) return;
    setBusy(true);
    setError(null);
    const request = { revision, owner, ...(remove ? { remove } : {}) };
    try {
      const transaction = await client.account.rules.prepareEnforcement(
        walletId,
        entry.provider,
        request,
      );
      const signature = transaction
        ? await send(
            transaction,
            remove ? "Remove rules from chain" : "Enforce rules on chain",
          )
        : undefined;
      onRules(
        await settled(
          () =>
            client.account.rules.confirmEnforcement(walletId, entry.provider, {
              ...request,
              ...(signature ? { transaction_signature: signature } : {}),
            }),
          retryDelayMs,
        ),
      );
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "";
      setError(
        /user rejected|user denied|4001/i.test(raw)
          ? "Signature declined. Nothing changed."
          : rulesFailure(cause, raw || "That didn’t go through. Try again."),
      );
      onStale();
    } finally {
      setBusy(false);
    }
  };

  const bound = entry.state !== "off";
  return (
    <>
      <ListRow
        data-rule-enforcement={entry.provider}
        data-state={entry.state}
        title={
          <span className="flex flex-col">
            <span className="type-meta text-aomi-muted font-normal">
              Also enforced on chain
            </span>
            {entry.name} · {STATE[entry.state]}
          </span>
        }
        description={
          <span className="whitespace-normal">
            {entry.note ??
              (bound
                ? `${entry.name} checks every trade, even if Aomi is wrong. Your wallet is its only admin.`
                : `Have ${entry.name} check these rules too. Your wallet signs once and stays its only admin.`)}
            {canSign
              ? null
              : ` Connect ${
                  owner && owner !== connected
                    ? shortAddress(owner)
                    : `${FAMILY[family]} wallet`
                } to change this.`}
          </span>
        }
        trailing={
          <span className="flex items-center gap-1">
            {bound ? (
              <AomiButton
                variant="ghost"
                size="sm"
                disabled={busy || !canSign}
                onClick={() => void run(true)}
              >
                Turn off
              </AomiButton>
            ) : null}
            {entry.ready ? (
              <AomiButton
                size="sm"
                disabled={busy || !canSign}
                onClick={() => void run(false)}
              >
                {bound ? "Update" : "Turn on"}
              </AomiButton>
            ) : null}
          </span>
        }
      />
      {error ? (
        <div className="px-3.5 pb-3">
          <SheetAlert>{error}</SheetAlert>
        </div>
      ) : null}
    </>
  );
}
