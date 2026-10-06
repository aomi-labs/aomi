import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import {
  printBoundaryForTurn,
  resolveSvmAddressForChat,
} from "../../src/cli/commands/chat";
import type { Event, MessageEvent } from "../../src/agent/types";

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
