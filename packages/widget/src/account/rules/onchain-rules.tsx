"use client";

import { useEffect, useState } from "react";
import { useDisplayQuery } from "@aomi-labs/react";
import {
  normalizeSolanaCluster,
  type AomiBindOnchainPolicy,
  type AomiOnchainPolicy,
  type AomiOnchainPolicyProviderCtx,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { ListGroup } from "@/ui/aomi/list-group";
import { StatusPill } from "@/ui/aomi/status-pill";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import { useAomiWalletKit } from "@/wallet/context";
import { useShellAomi } from "@/account/transport";
import { useAccountProfileQuery } from "@/account/account-overview";
import {
  MINT_DECIMALS,
  atomicToSol,
  confirmPolicy,
  confirmPolicyRevoke,
  explainPolicyError,
  fromAtomic,
  isPolicyProviderUnavailable,
  policyErrorCode,
} from "@/account/policy/policy-api";

const CHAIN_WARNINGS = {
  drifted:
    "What is on chain no longer matches what you signed. Update it before relying on it.",
  missing: "The policy you signed is not on chain. Update it to install it.",
  unavailable:
    "The chain could not be read just now, so this is unverified. Try again shortly.",
};

/**
 * One agent wallet's Swig context on the connected Solana network: its
 * binding, what is left of its limits, and its rules as a Swig policy.
 * `available` is false until it loads, and stays false where the deployment
 * has Swig off.
 */
export function useWalletLimits(delegate: string | undefined) {
  const wallet = useAomiWalletKit();
  const policies = useShellAomi().account.policies;
  const network =
    normalizeSolanaCluster(wallet.identity.svmCluster) ?? "solana:mainnet";
  const query = useDisplayQuery({
    resource: "transaction-safety",
    parameters: ["swig", network, delegate],
    enabled: Boolean(delegate),
    fetcher: (signal) => policies.get(network, { signal, delegate }),
  });
  const unavailable = Boolean(
    query.error && isPolicyProviderUnavailable(query.error),
  );
  return { query, unavailable, available: Boolean(query.data) && !unavailable };
}

/** What a policy holds, as the sentences the Rules section uses. */
export function policyLines(
  policy: AomiOnchainPolicy,
  ctx: Pick<AomiOnchainPolicyProviderCtx, "targets" | "mints">,
): string[] {
  const name = (
    catalog: Record<string, { address: string }>,
    address: string,
  ) =>
    Object.entries(catalog).find(([, entry]) => entry.address === address)?.[0];
  const apps: string[] = [];
  const limits: string[] = [];
  for (const rule of policy.rules) {
    if (rule.type === "allowed_call_target")
      apps.push(name(ctx.targets, rule.target.address) ?? rule.target.address);
    else if (rule.type === "recurring_native_asset_limit")
      limits.push(`Up to ${atomicToSol(rule.amount)} SOL a day`);
    else if (rule.type === "recurring_token_asset_limit") {
      const symbol = name(ctx.mints, rule.mint.address);
      const decimals = symbol ? MINT_DECIMALS[symbol] : undefined;
      limits.push(
        symbol && decimals !== undefined
          ? `Up to ${fromAtomic(rule.amount, decimals)} ${symbol} a day`
          : `Up to ${rule.amount} of ${rule.mint.address} a day`,
      );
    }
  }
  return [...(apps.length ? [`Can use ${apps.join(", ")}`] : []), ...limits];
}

/**
 * Wallet › Manage › Rules › On chain: the same rules, enforced a second time
 * by Swig on Solana. There is nothing to fill in. The policy comes from the
 * wallet's rules, and the connected Solana wallet signs it as the Swig
 * wallet's root. Renders nothing where the deployment has Swig off.
 *
 * `revision` is the rules' revision: the row reads the policy again when the
 * rules change, and says when the chain is behind them.
 */
export function OnchainRules({
  delegate,
  revision,
}: {
  delegate: string;
  revision: number;
}) {
  const wallet = useAomiWalletKit();
  const policies = useShellAomi().account.policies;
  const profileQuery = useAccountProfileQuery();
  const linked = profileQuery.data?.user_accounts ?? null;
  const { query, unavailable } = useWalletLimits(delegate);
  const ctx = query.data ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = query.refetch;
  useEffect(() => {
    void refetch();
  }, [refetch, revision]);

  const fromRules = ctx?.from_rules ?? null;
  if (unavailable || !ctx || !fromRules) return null;

  const owner = wallet.identity.svmAddress;
  const binding = ctx.binding;
  const policy = fromRules.policy;
  const behind = Boolean(binding) && !fromRules.in_sync;
  const warning =
    binding && ctx.chain_status && ctx.chain_status !== "current"
      ? CHAIN_WARNINGS[ctx.chain_status]
      : null;

  const send = async (unsignedTx: string, description: string) => {
    const execute =
      wallet.signAndSendSolanaTransaction ?? wallet.sendSolanaTransaction;
    if (!execute)
      throw new Error("Connect a Solana wallet that can send transactions.");
    return execute({
      unsignedTx,
      description,
      cluster: wallet.identity.svmCluster ?? "solana:mainnet",
    });
  };

  // One wallet ceremony at a time; whatever happens, read the chain again.
  const run = async (ceremony: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await ceremony();
    } catch (cause) {
      setError(
        policyErrorCode(cause) === "stale_policy_binding"
          ? "The policy changed. Review it and try again."
          : explainPolicyError(cause),
      );
    } finally {
      await refetch();
      setBusy(false);
    }
  };

  const enforce = () => {
    if (!policy || !owner) return;
    return run(async () => {
      if (
        !linked?.some(
          (account) =>
            account.address.chain === "svm" &&
            account.address.address === owner,
        )
      )
        throw new Error(
          "The connected Solana wallet is not linked to this Aomi account.",
        );
      const body: AomiBindOnchainPolicy = {
        binding_id: binding?.id ?? null,
        owner: { chain: "svm", address: owner },
        delegate: { chain: "svm", address: delegate },
        chain_ref: ctx.chain_ref,
        policy,
        transaction_signature: null,
      };
      const prepared = await policies.prepare(body);
      const signature = prepared.unsigned_transaction_base64
        ? (
            await send(
              prepared.unsigned_transaction_base64,
              prepared.operation === "update"
                ? "Update rules on chain"
                : "Enforce rules on chain",
            )
          ).signature
        : null;
      await confirmPolicy(policies, {
        ...body,
        transaction_signature: signature,
      });
    });
  };

  const remove = () => {
    if (!binding) return;
    return run(async () => {
      const prepared = await policies.prepareRevoke(binding.id);
      if (!prepared.unsigned_transaction_base64)
        throw new Error("No transaction was returned.");
      const { signature } = await send(
        prepared.unsigned_transaction_base64,
        "Remove rules from chain",
      );
      await confirmPolicyRevoke(policies, binding.id, signature);
    });
  };

  const onChain = binding ? policyLines(binding.policy, ctx) : [];
  const next = policy ? policyLines(policy, ctx) : [];
  const left = [
    ctx.remaining_native_amount
      ? `${atomicToSol(ctx.remaining_native_amount)} SOL`
      : null,
    ...Object.entries(ctx.mints).map(([symbol, mint]) => {
      const amount = ctx.remaining_token_amounts[mint.address];
      const decimals = MINT_DECIMALS[symbol];
      return amount !== undefined && decimals !== undefined
        ? `${fromAtomic(amount, decimals)} ${symbol}`
        : null;
    }),
  ].filter((entry): entry is string => entry !== null);

  return (
    <ListGroup>
      <div
        data-onchain-rules={binding ? (behind ? "behind" : "on") : "off"}
        className="flex flex-col gap-2 px-3.5 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="type-meta text-aomi-muted">On chain</span>
            <span className="type-control">Swig on Solana</span>
          </span>
          <StatusPill>
            {binding ? (behind ? "Behind your rules" : "On") : "Off"}
          </StatusPill>
        </div>
        <p className="type-meta text-aomi-muted">
          {binding
            ? "Swig checks these on every trade, even if Aomi is wrong. Your Solana wallet is its only admin."
            : "Have Swig check these rules on every trade too. Your Solana wallet signs once and stays its only admin."}
        </p>
        {binding ? (
          <ul aria-label="On chain now" className="type-control">
            {onChain.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {left.length ? (
          <p className="type-meta text-aomi-muted">
            Left on chain: {left.join(", ")}
          </p>
        ) : null}
        {(!binding || behind) && next.length ? (
          <ul
            aria-label={binding ? "After you update" : "Goes on chain"}
            className="type-control"
          >
            {behind ? (
              <li className="type-meta text-aomi-muted">After you update:</li>
            ) : null}
            {next.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {fromRules.aomi_only.length ? (
          <p className="type-meta text-aomi-muted">
            Aomi alone enforces: {fromRules.aomi_only.join(" · ")}
          </p>
        ) : null}
        {fromRules.missing ? (
          <p className="type-meta text-aomi-muted">{fromRules.missing}</p>
        ) : null}
        {warning ? <SheetAlert>{warning}</SheetAlert> : null}
        {error ? <SheetAlert>{error}</SheetAlert> : null}
        {!owner && policy ? (
          <p className="type-meta text-aomi-muted">
            Connect the Solana wallet that will own these rules.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {binding ? (
            <AomiButton
              variant="ghost"
              size="sm"
              disabled={busy || !owner}
              onClick={() => void remove()}
            >
              Remove from chain
            </AomiButton>
          ) : null}
          {!binding || behind || warning ? (
            <AomiButton
              variant="primary"
              size="sm"
              disabled={busy || !owner || !policy}
              onClick={() => void enforce()}
            >
              {binding ? "Update on chain" : "Enforce on chain"}
            </AomiButton>
          ) : null}
        </div>
      </div>
    </ListGroup>
  );
}
