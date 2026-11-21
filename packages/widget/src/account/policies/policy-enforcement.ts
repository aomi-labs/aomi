"use client";

import { useState } from "react";
import {
  normalizeSolanaCluster,
  shortAddress,
  type AomiPolicyAction,
  type AomiPolicyEnforcement,
  type AomiPolicyTypedData,
  type AomiWalletPolicies,
  type WalletEip712Payload,
} from "@aomi-labs/client";
import { useAomiWalletKit } from "@/wallet/context";
import type { AomiWalletKit } from "@/wallet/types";
import { isExpectedWalletCancellation } from "@/wallet/picker/wallet-cancellation";
import {
  connectedAddress,
  type RulesClient,
} from "@/account/rules/rule-change-card";
import {
  rulesErrorCode,
  rulesFailure,
  sameWallet,
} from "@/account/rules/rules-model";
import { enforcementKey, sendsRevocation } from "./policy-model";
import {
  DELEGATION_MANAGER,
  SIMPLE_FACTORY,
  deploysVaultOf,
} from "./vault-withdraw";

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

const INTEGER_TYPE = /^u?int\d*$/;
const DECIMAL = /^-?\d+$/;
const HEX_NUMBER = /^0x[0-9a-f]+$/i;

const unreadable = (path: string) =>
  new Error(`The data to sign has a number this wallet can't read (${path}).`);

/** An integer field as a bigint: never a number past 2^53, which JSON rounded. */
function integer(value: unknown, path: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  if (
    typeof value === "string" &&
    (DECIMAL.test(value) || HEX_NUMBER.test(value))
  )
    return BigInt(value);
  throw unreadable(path);
}

/** `value` of EIP-712 `type`: integers as bigint, structs and arrays walked. */
function typedValue(
  type: string,
  value: unknown,
  types: AomiPolicyTypedData["types"],
  path: string,
): unknown {
  if (type.endsWith("]")) {
    if (!Array.isArray(value)) throw unreadable(path);
    const item = type.slice(0, type.lastIndexOf("["));
    return value.map((entry, index) =>
      typedValue(item, entry, types, `${path}[${index}]`),
    );
  }
  if (INTEGER_TYPE.test(type)) return integer(value, path);
  const fields = types[type];
  if (!fields) return value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unreadable(path);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      typedValue(
        field.type,
        record[field.name],
        types,
        `${path}.${field.name}`,
      ),
    ]),
  );
}

/**
 * The backend's typed data as the wallet signs it: declared integers become
 * bigints (they arrive as strings past 2^53). Refuses JSON-rounded numbers
 * and a domain for another chain than `chainId`.
 */
export function signableTypedData(data: AomiPolicyTypedData, chainId: number) {
  if (!data.types[data.primaryType])
    throw new Error("The data to sign names a type it does not define.");
  const domain = { ...data.domain };
  if (domain.chainId !== undefined) {
    if (integer(domain.chainId, "domain.chainId") !== BigInt(chainId))
      throw new Error(
        "The data to sign is for another chain than this policy's.",
      );
    domain.chainId = chainId;
  }
  return {
    domain,
    types: data.types,
    primaryType: data.primaryType,
    message: typedValue(
      data.primaryType,
      data.message,
      data.types,
      "message",
    ) as Record<string, unknown>,
  } as NonNullable<WalletEip712Payload["typed_data"]>;
}

const PLAIN_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function switchToChain(
  kit: Pick<AomiWalletKit, "identity" | "switchChain">,
  chainId: number,
) {
  if (kit.identity.chainId !== chainId && kit.switchChain)
    await kit.switchChain(chainId);
}

/** Submit from the connected account and wait for the receipt. */
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
  await send(
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
}

async function act(
  kit: AomiWalletKit,
  entry: AomiPolicyEnforcement,
  action: AomiPolicyAction,
  description: string,
  owner: string,
): Promise<{ signature?: string }> {
  if (action.network !== entry.network)
    throw new Error(
      "Aomi asked for a signature on another network than this policy's. Nothing was signed.",
    );
  if (action.kind === "typed_data") {
    const chainId = /^eip155:(\d+)$/.exec(action.network)?.[1];
    if (entry.signer.family !== "evm" || !chainId || !kit.signTypedData)
      throw new Error("This wallet can't sign that.");
    const typed_data = signableTypedData(action.typed_data, Number(chainId));
    await switchToChain(kit, Number(chainId));
    const { signature } = await kit.signTypedData({
      typed_data,
      signer: owner,
      chainId: Number(chainId),
      description,
    });
    if (!/^0x[0-9a-f]+$/i.test(signature))
      throw new Error("Your wallet returned no signature.");
    return { signature };
  }
  if (action.kind === "evm_transaction") {
    const chainId = /^eip155:(\d+)$/.exec(action.network)?.[1];
    if (entry.signer.family !== "evm" || !chainId || !kit.sendTransaction)
      throw new Error("This wallet can't send that.");
    if (!PLAIN_ADDRESS.test(action.to))
      throw new Error(
        "Aomi asked to send to something that is not an address. Nothing was sent.",
      );
    // A MetaMask revocation goes to the manager. An undeployed vault is first
    // created by the factory, and only as this owner's vault.
    const to = action.to.toLowerCase();
    const deploysOwnVault =
      to === SIMPLE_FACTORY && deploysVaultOf(action.data, owner);
    if (
      entry.provider === "metamask" &&
      to !== DELEGATION_MANAGER &&
      !deploysOwnVault
    )
      throw new Error("The revocation targets a different delegation manager.");
    if (BigInt(action.value) !== BigInt(0))
      throw new Error(
        "Aomi asked to send funds with the revocation. Nothing was sent.",
      );
    if (
      !sameWallet(
        { family: "evm", address: owner },
        "evm",
        kit.identity.address,
      )
    )
      throw new Error(
        "Send this from the wallet that owns the policy. Nothing was sent.",
      );
    await switchToChain(kit, Number(chainId));
    await sendPlainTransaction(kit.sendTransaction, {
      requestId: "policy-revocation",
      chainId: Number(chainId),
      to: action.to,
      data: action.data,
      value: action.value,
    });
    return {};
  }
  const execute = kit.signAndSendSolanaTransaction ?? kit.sendSolanaTransaction;
  const cluster = normalizeSolanaCluster(action.network);
  if (entry.signer.family !== "svm" || !cluster || !execute)
    throw new Error("This wallet can't sign that transaction.");
  await execute({ unsignedTx: action.unsigned_base64, description, cluster });
  return {};
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
  // Solana nodes refuse a transaction built against another network.
  if (/blockhash not found|block ?hash.*(expired|not found)/i.test(text))
    return "Your wallet’s Solana network doesn’t know the block this transaction was built on. Use a wallet on the same network as Aomi, or try again.";
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/** A replacement can keep the same rule key after the old grant is disabled. */
const stillHeld = (rules: AomiWalletPolicies, key: string) =>
  rules.enforcement.some(
    (entry) => enforcementKey(entry) === key && sendsRevocation(entry),
  );

/** One provider's step as a policy row shows it. */
export type EnforcementStep = {
  busy: boolean;
  disabled: boolean;
  /** Which wallet to connect, or what is being signed while the wallet asks. */
  hint: string | null;
  error: string | null;
  run: () => void;
};

/**
 * Prepare, sign in the owner's wallet, confirm: one rule on chain, the same
 * for every provider. `step` backs "Sign to deploy"; `takeOff` backs a
 * removed policy still on chain.
 */
export function useRuleEnforcement({
  client,
  walletId,
  revision,
  onRules,
  onStale,
  retryDelayMs = 2_000,
}: {
  client: RulesClient;
  walletId: string;
  revision: number;
  onRules: (rules: AomiWalletPolicies) => void;
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
    const request = {
      network: entry.network,
      rule: entry.rule,
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
      let signature: string | undefined;
      if (action) {
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
        signature = (
          await act(
            kit,
            entry,
            action,
            remove ? "Remove policy from chain" : "Enforce policy on chain",
            owner,
          )
        ).signature;
      }
      const confirm = () =>
        settled(
          () =>
            client.account.rules.confirmEnforcement(walletId, entry.provider, {
              ...request,
              ...(signature ? { signature } : {}),
            }),
          retryDelayMs,
        );
      let rules = await confirm();
      // No signature proves a sent tx: rules come back unchanged until the
      // backend's node shows it.
      if (action?.kind === "evm_transaction") {
        for (
          let attempt = 0;
          attempt < 5 && stillHeld(rules, key);
          attempt += 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          rules = await confirm();
        }
      }
      onRules(rules);
      if (action?.kind === "evm_transaction" && stillHeld(rules, key)) {
        setErrors((held) => ({
          ...held,
          [key]:
            "Your transaction was sent, but Aomi doesn’t see it on the chain yet. Check again in a moment before sending anything more.",
        }));
        onStale();
      }
    } catch (cause) {
      const raw = failureText(cause);
      setErrors((held) => ({
        ...held,
        [key]: isExpectedWalletCancellation(cause)
          ? "Signature declined. Nothing changed."
          : rulesFailure(cause, raw || "That didn’t go through. Try again."),
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
    return {
      busy: busy === key,
      disabled: busy !== null || !canSign,
      hint: canSign
        ? (signing[key] ?? null)
        : `Connect ${
            owner && owner !== connected
              ? shortAddress(owner)
              : `${FAMILY[entry.signer.family]} wallet`
          } to ${remove && sendsRevocation(entry) ? "send" : "sign"}.`,
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
