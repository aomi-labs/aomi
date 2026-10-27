import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommitView } from "@aomi-labs/client";
import {
  secondsUntilExpiry,
  signDeadline,
  useBlockhashCountdown,
} from "./blockhash-countdown";

const commit = (lastValid: number | null) =>
  ({
    commit_id: "sol",
    chain_family: "svm",
    chain_ref: "mainnet-beta",
    action: {
      kind: "sign",
      payload: {
        kind: "svm_transaction",
        signer: "So1",
        transaction_base64: "AA==",
        last_valid_block_height: lastValid,
      },
    },
  }) as unknown as CommitView;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("blockhash countdown", () => {
  it("turns remaining blocks into seconds and never goes below zero", () => {
    expect(secondsUntilExpiry(1_150, 1_000)).toBe(60);
    // One block left is still time to sign; only a height past it is expiry.
    expect(secondsUntilExpiry(1_150, 1_150)).toBe(1);
    expect(secondsUntilExpiry(1_000, 1_010)).toBe(0);
  });

  it("only applies to an unsigned Solana transaction with a deadline", () => {
    expect(signDeadline(commit(1_150))).toBe(1_150);
    expect(signDeadline(commit(null))).toBeUndefined();
    expect(
      signDeadline({ ...commit(1_150), chain_family: "evm" } as CommitView),
    ).toBeUndefined();
    expect(signDeadline(undefined)).toBeUndefined();
  });

  it("counts down from the cluster's height and expires only from a poll", async () => {
    vi.useFakeTimers();
    let height = 1_145;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ result: height }) })),
    );
    const { result } = renderHook(() =>
      useBlockhashCountdown(commit(1_150), "https://rpc.example"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(2);
    // The clock alone stops at a second left.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current).toBe(1);
    // The next poll sees the chain past the deadline.
    height = 1_151;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current).toBe(0);
  });
});
