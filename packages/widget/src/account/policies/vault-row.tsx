"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { shortAddress } from "@aomi-labs/client";
import { cn } from "@/lib/cn";
import { AomiButton } from "@/ui/aomi/button";
import { isExpectedWalletCancellation } from "@/wallet/picker/wallet-cancellation";
import { SheetAlert } from "@/wallet/picker/sheet-parts";
import { ChainMark, INPUT, PickChip, tokenGlyph } from "./policies-view";
import {
  exactAmount,
  holdingsLine,
  nonzero,
  parseWithdrawAmount,
  sameHoldings,
  tokenKey,
  type Vault,
  type VaultHolding,
  type VaultToken,
} from "./vault-model";
import type { WithdrawAsset } from "./vault-withdraw";

/** What a vault's balances are read with: its tokens in, what it holds out. */
export type ReadBalances = (
  tokens: readonly VaultToken[],
) => Promise<VaultHolding[]>;

/** Moves `amount` of `asset` out of the vault; `no_vault` if it has no code yet. */
export type WithdrawVault = (
  asset: WithdrawAsset,
  amount: bigint,
) => Promise<"sent" | "no_vault">;

/**
 * A vault's balances, read when its tokens change and again on `refresh`. A
 * read that a newer one has overtaken, or that ends after the row is gone, is
 * dropped. `refresh` reads until the balances differ from `before`, a few
 * times, because the wallet's node may show a withdrawal before this one does.
 */
function useVaultBalances(
  read: ReadBalances,
  tokens: readonly VaultToken[],
  retryDelayMs: number,
) {
  const [holdings, setHoldings] = useState<VaultHolding[] | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  const latest = useRef({ read, tokens });
  const reads = useRef(0);
  useEffect(() => {
    latest.current = { read, tokens };
  });
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const id = (reads.current += 1);
    try {
      const next = await latest.current.read(latest.current.tokens);
      if (live.current && id === reads.current) {
        setHoldings(next);
        setFailed(false);
      }
      return next;
    } catch {
      if (live.current && id === reads.current) setFailed(true);
      return null;
    }
  }, []);

  const key = tokens.map(tokenKey).join(",");
  useEffect(() => {
    void load();
  }, [load, key]);

  const refresh = async (before: readonly VaultHolding[]) => {
    for (let attempt = 0; attempt < 4 && live.current; attempt += 1) {
      const next = await load();
      if (!next || !sameHoldings(next, before)) return;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  };
  return { holdings, failed, reload: load, refresh };
}

/**
 * The owner's vault in a wallet's card: its address, what it holds, and one
 * button, Withdraw. That opens the form inline: a token the vault holds, an
 * amount (`Max` fills it all), then Sign and send. The row reads balances and
 * asks `withdraw` to move them; it stores nothing and knows no wallet.
 */
export function VaultRow({
  vault,
  tokens,
  readBalances,
  withdraw,
  signer,
  retryDelayMs = 2_000,
}: {
  vault: Vault;
  /** What the vault may hold; those with a balance are offered. */
  tokens: readonly VaultToken[];
  readBalances: ReadBalances;
  withdraw: WithdrawVault;
  /** The owner's wallet is not the connected one: Withdraw waits, with why. */
  signer: { canSign: boolean; hint: string | null };
  /** Between reads while a withdrawal is not yet shown in the balances. */
  retryDelayMs?: number;
}) {
  const { holdings, failed, reload, refresh } = useVaultBalances(
    readBalances,
    tokens,
    retryDelayMs,
  );
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const held = nonzero(holdings ?? []);
  const chosen =
    held.find((entry) => tokenKey(entry.token) === picked) ?? held[0];
  const address = shortAddress(vault.address);

  const close = () => {
    setOpen(false);
    setPicked(null);
    setDraft("");
    setProblem(null);
    setError(null);
  };

  const submit = async () => {
    if (busy || !chosen) return;
    const parsed = parseWithdrawAmount(draft, chosen.token, chosen.raw);
    if ("error" in parsed) {
      setProblem(parsed.error);
      return;
    }
    setBusy(true);
    setProblem(null);
    setError(null);
    try {
      const outcome = await withdraw(chosen.token.asset, parsed.amount);
      if (outcome === "no_vault") {
        setEmpty(true);
        return;
      }
      close();
      setNotice("Withdrawn.");
      await refresh(holdings ?? []);
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "";
      setError(
        isExpectedWalletCancellation(cause)
          ? "Declined in your wallet. Nothing was withdrawn."
          : raw || "That didn’t go through. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-vault={vault.key} className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <p className="type-control flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>Vault</span>
          {vault.explorer ? (
            <a
              href={vault.explorer}
              target="_blank"
              rel="noreferrer"
              className="type-address text-aomi-muted hover:text-aomi-fg inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              {address}
              <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : (
            <span className="type-address text-aomi-muted">{address}</span>
          )}
          <ChainMark chain={vault.chain} />
        </p>
        {notice ? (
          <span role="status" className="type-meta font-medium">
            {notice}
          </span>
        ) : null}
        <AomiButton
          variant="primary"
          size="sm"
          aria-expanded={open}
          disabled={busy || !signer.canSign || held.length === 0}
          onClick={() => {
            if (open) return close();
            setNotice(null);
            setEmpty(false);
            setOpen(true);
          }}
        >
          Withdraw
        </AomiButton>
      </div>

      <p className="type-meta text-aomi-muted flex items-center gap-2">
        {failed ? (
          <>
            Couldn’t read the balance.
            <button
              type="button"
              onClick={() => void reload()}
              className="hover:text-aomi-fg underline underline-offset-2"
            >
              Try again
            </button>
          </>
        ) : holdings === null ? (
          "Reading the balance…"
        ) : (
          (holdingsLine(holdings) ?? "Nothing in the vault.")
        )}
      </p>
      {!signer.canSign && signer.hint ? (
        <p className="type-meta text-aomi-muted">{signer.hint}</p>
      ) : null}

      {open && empty ? (
        <p className="type-meta text-aomi-muted">
          Nothing to withdraw yet. Your vault is created with your first trade.
        </p>
      ) : open && chosen ? (
        <div
          role="group"
          aria-label="Withdraw from vault"
          className="flex flex-col gap-2.5"
        >
          <div
            role="group"
            aria-label="Token"
            className="flex flex-wrap gap-1.5"
          >
            {held.map((entry) => (
              <PickChip
                key={tokenKey(entry.token)}
                icon={tokenGlyph(entry.token.symbol)}
                label={entry.token.symbol}
                selected={entry === chosen}
                onClick={() => {
                  if (busy) return;
                  setPicked(tokenKey(entry.token));
                  setDraft("");
                  setProblem(null);
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              aria-label="Amount"
              placeholder="Amount"
              disabled={busy}
              className={cn(INPUT, "min-w-0 flex-1 tabular-nums")}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setProblem(null);
              }}
            />
            <AomiButton
              size="sm"
              disabled={busy}
              onClick={() => {
                setDraft(exactAmount(chosen.raw, chosen.token.decimals));
                setProblem(null);
              }}
            >
              Max
            </AomiButton>
          </div>
          {problem ? (
            <p className="type-meta text-aomi-danger">{problem}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="type-meta text-aomi-muted min-w-0 flex-1">
              Valid for 10 minutes. You pay the network fee.
            </p>
            <AomiButton
              variant="primary"
              size="sm"
              disabled={busy || !signer.canSign}
              onClick={() => void submit()}
            >
              {busy ? "Waiting for wallet…" : "Sign and send"}
            </AomiButton>
            <AomiButton
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </AomiButton>
          </div>
        </div>
      ) : null}
      {error ? <SheetAlert>{error}</SheetAlert> : null}
    </div>
  );
}
