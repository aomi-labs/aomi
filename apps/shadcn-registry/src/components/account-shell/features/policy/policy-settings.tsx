"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";
import type {
  AomiAccountProfile,
  AomiBindOnchainPolicy,
  AomiOnchainPolicyProviderCtx,
} from "@aomi-labs/client";
import { useAomiWalletKit } from "../../../../lib/wallet-kit/context";
import { useShellTransport } from "../../transport";
import {
  atomicToSol,
  confirmPolicy,
  confirmPolicyRevoke,
  explainPolicyError,
  fetchPolicy,
  policyErrorCode,
  policyFromForm,
  preparePolicy,
  preparePolicyRevoke,
} from "./policy-api";

function chainRef(cluster?: string): string {
  if (cluster === "solana:devnet") return "devnet";
  if (cluster === "solana:testnet") return "testnet";
  return "mainnet-beta";
}

const CHAIN_WARNINGS = {
  drifted:
    "On-chain permissions do not match the saved policy. Review and re-apply before relying on this agent.",
  missing:
    "The saved policy is not installed on-chain. Re-apply it before relying on this agent.",
  unavailable:
    "On-chain permissions could not be read right now, so this policy is unverified. Try again shortly.",
};

function short(address?: string): string {
  if (!address) return "—";
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

export function PolicySettings() {
  const wallet = useAomiWalletKit();
  const { json: request } = useShellTransport();
  const network = chainRef(wallet.identity.svmCluster);
  const [profile, setProfile] = useState<AomiAccountProfile | null>(null);
  const [ctx, setCtx] = useState<AomiOnchainPolicyProviderCtx | null>(null);
  const [delegate, setDelegate] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [amount, setAmount] = useState("1");
  const [limitKind, setLimitKind] = useState<"lifetime" | "recurring">(
    "recurring",
  );
  const [slotWindow, setSlotWindow] = useState(216_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextProfile, nextCtx] = await fetchPolicy(network, request);
      setProfile(nextProfile);
      setCtx(nextCtx);
      setSlotWindow((current) =>
        nextCtx.slot_windows.includes(current)
          ? current
          : (nextCtx.slot_windows[0] ?? current),
      );
      const binding = nextCtx.binding;
      if (binding) {
        setDelegate(binding.delegate.address);
        setTargets(
          binding.policy.rules
            .filter((rule) => rule.type === "allowed_call_target")
            .map((rule) => rule.target.address),
        );
        const limit = binding.policy.rules.find(
          (rule) => rule.type !== "allowed_call_target",
        );
        if (limit && "amount" in limit) setAmount(atomicToSol(limit.amount));
        if (limit?.type === "recurring_native_asset_limit") {
          setLimitKind("recurring");
          if (limit.window.unit === "slots") setSlotWindow(limit.window.value);
        } else if (limit?.type === "lifetime_native_asset_limit") {
          setLimitKind("lifetime");
        }
      }
    } catch (cause) {
      setError(explainPolicyError(cause));
    }
  }, [network, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const delegates = useMemo(() => {
    if (!profile) return [];
    const automatic = new Set(
      profile.signing_policies
        .filter(
          (policy) => policy.address.chain === "svm" && policy.mode === "auto",
        )
        .map((policy) => policy.address.address),
    );
    return profile.delegated_accounts.filter(
      (account) =>
        account.address.chain === "svm" &&
        account.status === "active" &&
        automatic.has(account.address.address),
    );
  }, [profile]);

  useEffect(() => {
    if (!delegate && delegates[0]) setDelegate(delegates[0].address.address);
  }, [delegate, delegates]);

  const owner = wallet.identity.svmAddress;
  const targetEntries = Object.entries(ctx?.targets ?? {});
  const canSubmit = Boolean(
    owner && delegate && targets.length && amount && !busy,
  );

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

  // A stale binding means the form was built on an outdated policy: reload it,
  // then explain, since `load` clears the error it starts with.
  const fail = async (cause: unknown) => {
    if (policyErrorCode(cause) === "stale_policy_binding") await load();
    setError(explainPolicyError(cause));
  };

  const save = async () => {
    if (!profile || !ctx || !owner || !delegate) return;
    setBusy(true);
    setError(null);
    try {
      if (
        !profile.user_accounts.some(
          (account) =>
            account.address.chain === "svm" &&
            account.address.address === owner,
        )
      ) {
        throw new Error(
          "The connected Solana wallet is not linked to this Aomi account.",
        );
      }
      const selectedTargets = targets.map((address) => {
        const target = Object.values(ctx.targets).find(
          (candidate) => candidate.address === address,
        );
        if (!target)
          throw new Error(
            "Refresh the supported policy targets and try again.",
          );
        return target;
      });
      const body: AomiBindOnchainPolicy = {
        binding_id: ctx.binding?.id ?? null,
        owner: { chain: "svm", address: owner },
        delegate: { chain: "svm", address: delegate },
        chain_ref: ctx.chain_ref,
        policy: policyFromForm(selectedTargets, amount, limitKind, slotWindow),
        transaction_signature: null,
      };
      const prepared = await preparePolicy(body, request);
      let signature: string | null = null;
      if (prepared.unsigned_transaction_base64) {
        signature = (
          await send(
            prepared.unsigned_transaction_base64,
            prepared.operation === "update"
              ? "Update Swig policy"
              : "Activate Swig policy",
          )
        ).signature;
      }
      await confirmPolicy(
        { ...body, transaction_signature: signature },
        request,
      );
      await load();
    } catch (cause) {
      await fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!ctx?.binding) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await preparePolicyRevoke(ctx.binding.id, request);
      if (!prepared.unsigned_transaction_base64)
        throw new Error("No revoke transaction was returned.");
      const { signature } = await send(
        prepared.unsigned_transaction_base64,
        "Revoke Swig policy",
      );
      await confirmPolicyRevoke(ctx.binding.id, signature, request);
      await load();
    } catch (cause) {
      await fail(cause);
    } finally {
      setBusy(false);
    }
  };

  if (!profile || !ctx) {
    return (
      <div className="text-aomi-muted px-6 py-8 text-sm">
        {error ?? "Loading policy…"}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[780px] space-y-4 px-6 py-6">
      <section className="border-aomi-border bg-aomi-surface-1 rounded-2xl border p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="bg-aomi-accent-subtle text-aomi-accent flex size-9 items-center justify-center rounded-xl">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Swig on Solana</h3>
              <p className="text-aomi-muted mt-1 text-[12px] leading-relaxed">
                Aomi configures a restricted role for your agent. Your connected
                wallet remains the root owner.
              </p>
            </div>
          </div>
          <span className="border-aomi-border bg-aomi-raised rounded-full border px-2.5 py-1 text-[11px]">
            {ctx.binding ? (ctx.chain_status ?? "Checking") : "Not active"}
          </span>
        </div>
        <div className="border-aomi-border mt-4 grid gap-3 border-t pt-4 text-[12px] sm:grid-cols-3">
          <div>
            <span className="text-aomi-muted block">Root owner</span>
            <span>{short(owner)}</span>
          </div>
          <div>
            <span className="text-aomi-muted block">Delegated agent</span>
            <span>{short(delegate)}</span>
          </div>
          <div>
            <span className="text-aomi-muted block">Network</span>
            <span>{ctx.chain_ref}</span>
          </div>
        </div>
      </section>

      {ctx.chain_status && ctx.chain_status !== "current" && (
        <div className="border-aomi-danger/30 bg-aomi-danger/5 text-aomi-danger flex gap-2 rounded-xl border px-3 py-2.5 text-[12px]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {CHAIN_WARNINGS[ctx.chain_status]}
        </div>
      )}

      <section className="border-aomi-border rounded-2xl border p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-2 text-[12px]">
            <span className="font-medium">Delegated agent</span>
            <select
              value={delegate}
              onChange={(event) => setDelegate(event.target.value)}
              disabled={Boolean(ctx.binding)}
              className="border-aomi-border bg-aomi-raised h-9 w-full rounded-lg border px-3 outline-none"
            >
              {delegates.map((account) => (
                <option key={account.id} value={account.address.address}>
                  {short(account.address.address)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-[12px]">
            <span className="font-medium">SOL limit</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="border-aomi-border bg-aomi-raised h-9 w-full rounded-lg border px-3 outline-none"
              placeholder="1.0"
            />
          </label>
        </div>

        <div className="mt-5">
          <span className="text-[12px] font-medium">Allowed apps</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {targetEntries.map(([name, target]) => {
              const checked = targets.includes(target.address);
              return (
                <label
                  key={target.address}
                  className="border-aomi-border hover:bg-aomi-hover flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-[12px]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setTargets((current) =>
                        checked
                          ? current.filter((item) => item !== target.address)
                          : [...current, target.address],
                      )
                    }
                  />
                  <span className="flex-1">
                    <span className="block font-medium">{name}</span>
                    <span className="text-aomi-muted">
                      {short(target.address)}
                    </span>
                  </span>
                  {checked && (
                    <CheckCircle2 className="text-aomi-accent size-4" />
                  )}
                </label>
              );
            })}
          </div>
          {!targetEntries.length && (
            <p className="text-aomi-muted mt-2 text-[12px]">
              No curated Swig targets are available on this network.
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-[12px]">
            <span className="font-medium">Limit behavior</span>
            <select
              value={limitKind}
              onChange={(event) =>
                setLimitKind(event.target.value as "lifetime" | "recurring")
              }
              className="border-aomi-border bg-aomi-raised h-9 w-full rounded-lg border px-3 outline-none"
            >
              <option value="recurring">Recurring</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </label>
          {limitKind === "recurring" && (
            <label className="space-y-2 text-[12px]">
              <span className="font-medium">Slot window</span>
              <select
                value={slotWindow}
                onChange={(event) => setSlotWindow(Number(event.target.value))}
                className="border-aomi-border bg-aomi-raised h-9 w-full rounded-lg border px-3 outline-none"
              >
                {ctx.slot_windows.map((window) => (
                  <option key={window} value={window}>
                    {window.toLocaleString()} slots
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {ctx.remaining_native_amount && (
          <p className="text-aomi-muted mt-4 text-[12px]">
            Remaining allowance: {atomicToSol(ctx.remaining_native_amount)} SOL
          </p>
        )}
        {error && <p className="text-aomi-danger mt-4 text-[12px]">{error}</p>}
        <div className="border-aomi-border mt-5 flex items-center justify-end gap-2 border-t pt-4">
          {ctx.binding && (
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy}
              className="text-aomi-danger hover:bg-aomi-hover h-9 rounded-lg px-3 text-[12px] font-medium disabled:opacity-50"
            >
              Revoke
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSubmit}
            className="bg-aomi-accent-strong text-aomi-on-accent h-9 rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
          >
            {busy
              ? "Waiting for wallet…"
              : ctx.binding
                ? "Update policy"
                : "Activate Swig"}
          </button>
        </div>
      </section>
    </div>
  );
}
