import { useEffect, useState } from "react";
import type { CommitView } from "@aomi-labs/client";

/** About how long a Solana block takes; a blockhash lives ~150 of them. */
const SLOT_SECONDS = 0.4;
const POLL_MS = 4_000;

/** Seconds until a blockhash valid through `lastValid` stops landing, given
 * the cluster's current block height. */
export function secondsUntilExpiry(lastValid: number, height: number): number {
  return Math.max(0, Math.round((lastValid - height) * SLOT_SECONDS));
}

/** The last valid block height of a Solana commit the wallet still has to
 * sign, else undefined. */
export function signDeadline(
  commit: CommitView | undefined,
): number | undefined {
  const action = commit?.action;
  if (
    commit?.chain_family !== "svm" ||
    action?.kind !== "sign" ||
    action.payload.kind !== "svm_transaction"
  )
    return undefined;
  return action.payload.last_valid_block_height ?? undefined;
}

/** Live seconds left to sign `commit` before its blockhash expires, from the
 * cluster's block height (re-read every few seconds, counted down between).
 * `null` while unknown or for anything but an unsigned Solana commit. */
export function useBlockhashCountdown(
  commit: CommitView | undefined,
  rpcUrl: string | undefined,
): number | null {
  const lastValid = signDeadline(commit);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    setLeft(null);
    if (lastValid == null || !rpcUrl) return;
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBlockHeight",
            params: [{ commitment: "confirmed" }],
          }),
        });
        const height = (await response.json())?.result;
        if (!cancelled && typeof height === "number")
          setLeft(secondsUntilExpiry(lastValid, height));
      } catch {
        // Unknown stays unknown; the next poll tries again.
      }
    };
    void read();
    const poll = setInterval(read, POLL_MS);
    const tick = setInterval(
      () => setLeft((current) => (current ? current - 1 : current)),
      1_000,
    );
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [lastValid, rpcUrl]);
  return left;
}
