"use client";

import { useState } from "react";
import {
  normalizeSolanaCluster,
  shortAddress,
  type AomiRulesAction,
  type AomiRulesEnforcement,
  type AomiRulesTypedData,
  type AomiWalletRules,
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
  types: AomiRulesTypedData["types"],
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
 * The backend's typed data as the wallet signs it. Numbers above 2^53 arrive
 * as decimal strings, so every field the types declare as an integer becomes
 * a bigint, and the domain's chain id a number; a number that JSON already
 * rounded, or a domain for another chain than `chainId`, is refused.
 */
export function signableTypedData(data: AomiRulesTypedData, chainId: number) {
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

/**
 * Have the owner's wallet do what the step for `entry` asked: send a
 * transaction, or sign typed data and hand back its signature. An action for
 * another network than the entry's, one this wallet has no name for, and one
 * the owner's wallet family cannot do are refused: nothing is ever sent to a
 * default network. A plain EVM transaction (the owner's signed revocation) is
 * sent from the wallet that owns the policy and only to a plain address,
 * carrying no value.
 */
async function act(
  kit: AomiWalletKit,
  entry: AomiRulesEnforcement,
  action: AomiRulesAction,
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
    // A wallet signs typed data for the chain it is on.
    if (kit.identity.chainId !== Number(chainId) && kit.switchChain)
      await kit.switchChain(Number(chainId));
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
    if (BigInt(action.value) !== BigInt(0))
      throw new Error(
        "Aomi asked to send funds with the revocation. Nothing was sent.",
      );
    // The transaction goes out from the connected account: it must be the
    // one that owns the policy.
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
    if (kit.identity.chainId !== Number(chainId) && kit.switchChain)
      await kit.switchChain(Number(chainId));
    // The wallet's own send waits for the receipt and throws when it
    // reverts; Aomi adds nothing to it (no account abstraction, no sponsor).
    await kit.sendTransaction(
      {
        requestId: "policy-revocation",
        aaPreference: "none",
        chainId: Number(chainId),
        to: action.to,
        data: action.data,
        value: action.value,
      },
      { chainIdAlreadySelected: Number(chainId) },
    );
    return {};
  }
  const execute = kit.signAndSendSolanaTransaction ?? kit.sendSolanaTransaction;
  const cluster = normalizeSolanaCluster(action.network);
  if (entry.signer.family !== "svm" || !cluster || !execute)
    throw new Error("This wallet can't sign that transaction.");
  await execute({ unsignedTx: action.unsigned_base64, description, cluster });
  return {};
}

/** The rules still carry the step's entry: the chain has not changed yet. */
const stillHeld = (rules: AomiWalletRules, key: string) =>
  rules.enforcement.some((entry) => enforcementKey(entry) === key);

/** One provider's step as a policy row shows it. */
export type EnforcementStep = {
  busy: boolean;
  /** The wallet that must sign is not the one connected here. */
  disabled: boolean;
  /**
   * Which wallet to connect, when it is not connected; while a wallet prompt
   * for typed data is open, what the owner is signing for.
   */
  hint: string | null;
  error: string | null;
  run: () => void;
};

/**
 * Putting one rule on chain with a provider: the backend prepares what to
 * sign, the owner's own wallet signs it, and the backend reads the chain (or
 * checks the signature) to confirm. It is the same for every provider and
 * there is nothing to fill in: the backend derives the deployment from the
 * rule. `step(entry)` is what a policy row needs for its "Sign to deploy"
 * button; each rule has its own entry and its own step. `takeOff(entry)` is
 * the same for a removed policy whose deployment the chain still holds.
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
  /** The rules as the backend read them after a step. */
  onRules: (rules: AomiWalletRules) => void;
  /** A step failed, so what is shown may be out of date. */
  onStale: () => void;
  retryDelayMs?: number;
}) {
  const kit = useAomiWalletKit();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** What the owner is about to sign, by step key, while the wallet asks. */
  const [signing, setSigning] = useState<Record<string, string>>({});

  const signerOf = (entry: AomiRulesEnforcement) => {
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

  /**
   * Put the rule on chain, replace what the chain holds for it, or `remove`
   * it. `summary` says what the owner signs, shown while a typed-data prompt
   * is open.
   */
  const run = async (
    entry: AomiRulesEnforcement,
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
        // A signed grant can also be the removal of an earlier grant: the
        // backend revokes what the chain holds before it asks for the new one.
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
      // A sent transaction has no signature to prove it: the backend reads
      // the chain, and answers the rules unchanged until its node shows it.
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
      const raw = cause instanceof Error ? cause.message : "";
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
    entry: AomiRulesEnforcement,
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

  /** The step for a rule's entry: "Sign to deploy". */
  const step = (entry: AomiRulesEnforcement, summary?: string) =>
    stepOf(entry, summary);

  /**
   * The step for the entry of a removed policy: "Sign to take off". The
   * provider asks for a revoking signature or a transaction, as it does to
   * deploy, and confirms once the chain no longer holds it.
   */
  const takeOff = (entry: AomiRulesEnforcement, summary?: string) =>
    stepOf(entry, summary, true);

  return { step, takeOff, run };
}
