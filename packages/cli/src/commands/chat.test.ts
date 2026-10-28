import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import {
  approvalHints,
  printBoundaryForTurn,
  resolveSvmAddressForChat,
} from "./chat";
import {
  AomiClient,
  type CommitView,
  type Event,
  type MessageEvent,
} from "@aomi-labs/client";

const keypair = Keypair.generate();
const secret = bs58.encode(keypair.secretKey);

describe("CLI chat wallet identity", () => {
  it("prefers the address derived from the private key", () => {
    expect(
      resolveSvmAddressForChat(
        "PersistedAddr11111111111111111111111111111",
        secret,
      ),
    ).toBe(keypair.publicKey.toBase58());
  });

  it("falls back to the persisted address without a key", () => {
    expect(
      resolveSvmAddressForChat(
        "J2w7ZT5Wd4ACuQAH3dmzjWoRhaqejMRoMRL4C7Qbg5Ks",
        undefined,
      ),
    ).toBe("J2w7ZT5Wd4ACuQAH3dmzjWoRhaqejMRoMRL4C7Qbg5Ks");
  });

  it("returns undefined without either source", () => {
    expect(resolveSvmAddressForChat(undefined, undefined)).toBeUndefined();
  });
});

describe("CLI chat output boundary", () => {
  it("skips prior-turn events and messages when resuming a session", () => {
    const events = [
      {
        event_id: "old-message",
        sequence: 1,
        turn_id: "old-turn",
        occurred_at: 1,
        type: "message",
        sender: "agent",
        content: "old answer",
      },
      {
        event_id: "new-processing",
        sequence: 2,
        turn_id: "new-turn",
        occurred_at: 2,
        type: "turn_state_changed",
        state: "processing",
      },
    ] as Event[];
    const messages = [events[0]] as MessageEvent[];

    expect(printBoundaryForTurn(events, messages, "new-turn")).toEqual({
      handledSequence: 1,
      printedAgentCount: 1,
    });
  });
});

describe("CLI chat approval hint", () => {
  const commit = (commit_id: string, state: string) =>
    ({ commit_id, state, version: 1 }) as unknown as CommitView;

  it("names `aomi tx approve` and the sign URL for each parked commit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const ref = String(input).split("/").pop()!;
      if (ref === "cmt_gone")
        return Response.json(
          { code: "commit_not_found", status: 404 },
          { status: 404 },
        );
      return Response.json({
        ...commit(ref, "awaiting_approval"),
        sign_url: `https://chat.aomi.dev/sign/${ref}`,
      });
    });
    const client = new AomiClient({
      baseUrl: "https://example.test",
      guest: false,
      fetch,
    });

    await expect(
      approvalHints(client, [
        commit("cmt_park", "awaiting_approval"),
        commit("cmt_sign", "needs_signature"),
        commit("cmt_gone", "awaiting_approval"),
      ]),
    ).resolves.toEqual([
      "Waiting for your approval: `aomi tx approve cmt_park` (or https://chat.aomi.dev/sign/cmt_park)",
      "Waiting for your approval: `aomi tx approve cmt_gone`",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
