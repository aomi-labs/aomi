"use client";

import { useState } from "react";
import {
  AomiPolicySentError,
  enforcementKey,
  expectedPolicyAction,
  shortAddress,
  type AomiPolicyEnforcement,
  type AomiPolicySigner,
  type AomiWalletPolicies,
} from "@aomi-labs/client";
import { useAomiWalletKit } from "@/wallet/context";
import type { AomiWalletKit } from "@/wallet/types";
import { isExpectedWalletCancellation } from "@/wallet/picker/wallet-cancellation";
import { canSendSolana, sendSolana } from "@/wallet/runtime/svm/transactions";
import {
  connectedAddress,
  type PolicyClient,
} from "@/account/policies/policy-change-card";
import { policyFailure, sameWallet } from "@/account/policies/policy-format";

const FAMILY = { evm: "an EVM", svm: "a Solana" };

export async function switchToChain(
  kit: Pick<AomiWalletKit, "identity" | "switchChain">,
  chainId: number,
) {
  if (kit.identity.chainId !== chainId && kit.switchChain)
    await kit.switchChain(chainId);
}

/** Submit from the connected account, wait for the receipt, answer the hash. */
export async function sendPlainTransaction(
  send: NonNullable<AomiWalletKit["sendTransaction"]>,
  tx: {
    requestId: string;
    chainId: number;
    to: string;
    data: string;
    value: string;
  },
) {
  const { txHash } = await send(
    {
      requestId: tx.requestId,
      aaPreference: "none",
      chainId: tx.chainId,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    },
    { chainIdAlreadySelected: tx.chainId },
  );
  return txHash;
}

/** The connected wallet kit as the SDK's policy signer. */
function policySigner(kit: AomiWalletKit): AomiPolicySigner {
  const { signTypedData, sendTransaction } = kit;
  return {
    evmAddress: connectedAddress(kit, "evm"),
    solanaAddress: connectedAddress(kit, "svm"),
    ...(signTypedData
      ? {
          signTypedData: async ({ typedData, ...request }) => {
            await switchToChain(kit, request.chainId);
            return (await signTypedData({ typed_data: typedData, ...request }))
              .signature;
          },
        }
      : {}),
    ...(sendTransaction
      ? {
          sendEvmTransaction: async (tx) => {
            await switchToChain(kit, tx.chainId);
            return sendPlainTransaction(sendTransaction, {
              requestId: "policy-revocation",
              ...tx,
            });
          },
        }
      : {}),
    ...(canSendSolana(kit)
      ? {
          sendSolanaTransaction: async ({ unsignedBase64, ...payload }) =>
            (await sendSolana(kit, { unsignedTx: unsignedBase64, ...payload }))
              .signature,
        }
      : {}),
  };
}

/**
 * Why the owner's connected wallet can't take this step, or null when it can
 * or the step asks nothing of a wallet.
 */
function unable(
  kit: AomiWalletKit,
  kind: ReturnType<typeof expectedPolicyAction>,
  remove: boolean,
): string | null {
  if (kind === null) return null;
  const send = kind === "evm_transaction";
  const end = `wallet to ${send ? "send it" : remove ? "take it off" : "deploy"}.`;
  if (kind === "transaction")
    return canSendSolana(kit)
      ? null
      : `This wallet can’t sign Solana transactions here. Connect another Solana ${end}`;
  if (send ? kit.sendTransaction : kit.signTypedData) return null;
  return `This wallet can’t ${send ? "send transactions" : "sign this policy"} here. Connect another EVM ${end}`;
}

/** What a wallet or network said when a step failed; wallets often throw plain objects. */
export function failureText(cause: unknown): string {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : cause && typeof cause === "object"
          ? [
              (cause as { shortMessage?: unknown }).shortMessage,
              (cause as { message?: unknown }).message,
              (cause as { details?: unknown }).details,
            ].find((text): text is string => typeof text === "string" && !!text)
          : undefined;
  const text = (message ?? "").trim();
  // The Solana wallet adapter's own errors carry a name and no message.
  if (
    !text &&
    /^Wallet(NotSelected|NotConnected|NotReady)Error$/.test(
      (cause as { name?: unknown } | null)?.name as string,
    )
  )
    return "No Solana wallet is connected to sign this. Connect one and try again.";
  // Solana nodes refuse a transaction built against another network.
  if (/blockhash not found|block ?hash.*(expired|not found)/i.test(text))
    return "Your wallet’s Solana network doesn’t know the block this transaction was built on. Use a wallet on the same network as Aomi, or try again.";
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/** One provider's step as a policy row shows it. */
export type EnforcementStep = {
  busy: boolean;
  disabled: boolean;
  /** Why the step is unavailable, or what is being signed while the wallet asks. */
  hint: string | null;
  error: string | null;
  run: () => void;
};

/**
 * Prepare, sign in the owner's wallet, confirm: one policy on chain, the same
 * for every provider. `step` backs "Sign to deploy"; `takeOff` backs a
 * removed policy still on chain.
 */
export function usePolicyEnforcement({
  client,
  walletId,
  revision,
  onConfirmed,
  onStale,
  retryDelayMs = 2_000,
}: {
  client: PolicyClient;
  walletId: string;
  revision: number;
  onConfirmed: (policies: AomiWalletPolicies) => void;
  /** A step failed; what is shown may be out of date. */
  onStale: () => void;
  retryDelayMs?: number;
}) {
  const kit = useAomiWalletKit();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState<Record<string, string>>({});

  const signerOf = (entry: AomiPolicyEnforcement) => {
    const { family } = entry.signer;
    const connected = connectedAddress(kit, family);
    // Once a rule is on chain, only the wallet that put it there signs.
    const owner = entry.signer.address ?? connected;
    return {
      connected,
      owner,
      canSign:
        Boolean(connected) &&
        Boolean(owner) &&
        sameWallet({ family, address: owner! }, family, connected),
    };
  };

  /** `summary` is shown while the wallet prompt is open. */
  const run = async (
    entry: AomiPolicyEnforcement,
    { remove = false, summary }: { remove?: boolean; summary?: string } = {},
  ) => {
    const key = enforcementKey(entry);
    const { owner } = signerOf(entry);
    if (busy || !owner) return;
    setBusy(key);
    setErrors(({ [key]: _, ...rest }) => rest);
    try {
      const done = await client.account.policy.enforce(
        walletId,
        entry,
        policySigner(kit),
        {
          revision,
          owner,
          remove,
          retryDelayMs,
          onAction: (action) => {
            if (summary && action.kind === "evm_transaction")
              setSigning((held) => ({
                ...held,
                [key]: `You’re sending: ${summary}. Your wallet pays the network fee.`,
              }));
            // Replacing a grant: the backend asks to revoke the old one first.
            if (summary && action.kind === "typed_data")
              setSigning((held) => ({
                ...held,
                [key]: `You’re signing for: ${summary}.${
                  entry.state === "behind" && !remove
                    ? " Replacing an earlier version takes two signatures: the old one is removed first, then you sign the new one."
                    : ""
                } Check it in your wallet.`,
              }));
          },
        },
      );
      onConfirmed(done.policies);
      if (!done.settled) {
        setErrors((held) => ({
          ...held,
          [key]: `Your transaction${done.transaction ? ` ${done.transaction}` : ""} was sent, but Aomi doesn’t see it on the chain yet. Check again in a moment before sending anything more.`,
        }));
        onStale();
      }
    } catch (thrown) {
      const sent = thrown instanceof AomiPolicySentError ? thrown : null;
      const cause = sent ? sent.cause : thrown;
      const raw = failureText(cause);
      setErrors((held) => ({
        ...held,
        [key]: isExpectedWalletCancellation(cause)
          ? "Signature declined. Nothing changed."
          : `${policyFailure(cause, raw || "That didn’t go through. Try again.")}${
              sent
                ? ` Your transaction ${sent.transaction} was sent: check again before sending anything more.`
                : ""
            }`,
      }));
      onStale();
    } finally {
      setSigning(({ [key]: _, ...rest }) => rest);
      setBusy(null);
    }
  };

  const stepOf = (
    entry: AomiPolicyEnforcement,
    summary?: string,
    remove = false,
  ): EnforcementStep => {
    const key = enforcementKey(entry);
    const { connected, owner, canSign } = signerOf(entry);
    // `takeOff` is for a removed policy, which `next` describes too.
    const kind = expectedPolicyAction(entry, { remove });
    const verb = kind === "evm_transaction" ? "send" : "sign";
    // A step that asks nothing of a wallet needs only the owner's name, which
    // the backend takes from the binding or from one of the account's wallets.
    const blocked =
      canSign || (kind === null && owner)
        ? unable(kit, kind, remove)
        : owner && owner !== connected
          ? `Only the wallet that set this policy can change it on chain. Connect ${shortAddress(owner)} to ${verb}.`
          : `Connect ${FAMILY[entry.signer.family]} wallet to ${verb}.`;
    return {
      busy: busy === key,
      disabled: busy !== null || blocked !== null,
      hint: blocked ?? signing[key] ?? null,
      error: errors[key] ?? null,
      run: () => void run(entry, { remove, summary }),
    };
  };

  const step = (entry: AomiPolicyEnforcement, summary?: string) =>
    stepOf(entry, summary);

  const takeOff = (entry: AomiPolicyEnforcement, summary?: string) =>
    stepOf(entry, summary, true);

  return { step, takeOff, run };
}
