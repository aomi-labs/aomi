import { describe, expect, it } from "vitest";

import {
  LAUNCH_PROOF_TTL_MS,
  launchProofIsFresh,
  type LaunchContext,
} from "./telegram";

const NOW = 1_800_000_000_000;

function context(authDateMs: number, withProof = true): LaunchContext {
  return {
    authDate: Math.floor(authDateMs / 1000),
    inTelegram: withProof,
    proof: withProof
      ? { botId: "1", initData: "raw", telegramUserId: "7" }
      : null,
    sessionId: "telegram:dm:7",
    permissionChain: null,
    permissionWallet: null,
    permissionMode: null,
    verified: withProof,
  };
}

describe("launchProofIsFresh", () => {
  it("accepts a proof inside the window the BFF honours", () => {
    expect(launchProofIsFresh(context(NOW), NOW)).toBe(true);
    expect(launchProofIsFresh(context(NOW - 60_000), NOW)).toBe(true);
  });

  it("rejects one past it", () => {
    // The gap that motivated this: the launch route accepts 24 hours, so a Mini
    // App left open still looks valid locally and then fails with `expired`.
    expect(
      launchProofIsFresh(context(NOW - 24 * 60 * 60 * 1000), NOW),
    ).toBe(false);
  });

  it("stays inside the server's five-minute window", () => {
    // Kept under the server's deadline so a request started just before the
    // boundary still lands.
    expect(LAUNCH_PROOF_TTL_MS).toBeLessThan(5 * 60 * 1000);
    expect(launchProofIsFresh(context(NOW - LAUNCH_PROOF_TTL_MS), NOW)).toBe(
      false,
    );
    expect(
      launchProofIsFresh(context(NOW - LAUNCH_PROOF_TTL_MS + 1_000), NOW),
    ).toBe(true);
  });

  it("has no deadline to miss without a proof", () => {
    // Local preview: there is no proof, so nothing can go stale.
    expect(launchProofIsFresh(context(0, false), NOW)).toBe(true);
    expect(launchProofIsFresh(null, NOW)).toBe(true);
  });
});
