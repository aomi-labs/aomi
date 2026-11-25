// @vitest-environment node
import type { CommitRefView, CommitReview } from "@aomi-labs/client";
import { encodeFunctionData, parseAbi, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { Card } from "./review";
import { stepLine } from "./trace";

const ME = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const THEM = "0x00000000000000000000000000000000000000bb";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL2 = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const SYSTEM = "11111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const transfer = encodeFunctionData({
  abi: parseAbi(["function transfer(address to, uint256 amount)"]),
  args: [THEM, 2_000_000n],
});
const leg = (data: string, label = "Pay") => ({
  chain_id: 8453,
  from: ME,
  to: USDC,
  data,
  label,
  kind: "call",
});
const simulation = {
  status: "passed",
  balanceChanges: [] as object[],
  approvals: [] as object[],
  fees: [] as object[],
  warnings: [],
  guards: [],
  gas: { units: "50000" } as object | null,
  logs: [],
};
const payload = {
  kind: "evm_transaction",
  transaction: { gas_limit: 50_000, max_fee_per_gas: "2000000000" },
};
const view = (more: object = {}) =>
  ({
    version: 3,
    commit_id: "c1",
    chain_family: "evm",
    chain_ref: "8453",
    signer: ME,
    state: "needs_signature",
    batch: null,
    action: { kind: "sign", payload },
    sign_url: "https://chat.example/sign/c1",
    ...more,
  }) as unknown as CommitRefView;
const batch = (count: number) => ({
  batch: {
    ordered_commit_ids: Array.from({ length: count }, (_, i) => `c${i}`),
  },
});
const evm = (transactions: object[], more: object = {}) =>
  ({
    type: "execute_evm",
    transactions,
    simulation: { ...simulation, ...more },
  }) as unknown as CommitReview;
const svm = (instructions: object[], more: object = {}) =>
  ({
    type: "execute_svm",
    transactions: [{ payer: SOL, description: "Send", instructions }],
    simulation: {
      ...simulation,
      gas: null,
      fees: [{ asset: "native", amount: "5000" }],
      ...more,
    },
  }) as unknown as CommitReview;
const svmView = view({
  chain_family: "svm",
  chain_ref: "mainnet-beta",
  signer: SOL,
  action: null,
});
const message = (payload: object, more: object = {}) =>
  ({
    type: "sign",
    requestId: "r",
    chainFamily: "evm",
    executionKind: "evm_message",
    signer: ME,
    description: "Sign",
    payloads: [payload],
    messageReview: { kind: "generic", rows: [] },
    ...more,
  }) as unknown as CommitReview;
const open = (review?: CommitReview, of = view()) => {
  const card = new Card(of, review);
  return { whole: card.whole, text: card.lines.join("\n") };
};

describe("what a card shows of a call", () => {
  it("decodes it from its bytes, with its chain and its target", () => {
    const { whole, text } = open(evm([leg(transfer)]));
    expect(whole).toBe(true);
    expect(text).toContain("evm:8453 Base");
    expect(text).toContain(`to ${USDC}`);
    expect(text).toContain(`transfer(to: ${THEM}, amount: 2000000)`);
    expect(text).not.toContain("sign page");
  });

  it.each([
    ["an unknown call", "0x12345678"],
    ["bytes after the arguments", `${transfer}00`],
    ["missing arguments", transfer.slice(0, 80)],
  ])("sends %s to the sign page, whatever its label says", (_, data) => {
    const { whole, text } = open(
      evm([leg(data, `Pay\nusdc.transfer(to: wallet, amount: 1)`)]),
    );
    expect(whole).toBe(false);
    expect(text).toContain("not decoded here");
    expect(text).toContain("Review this on the sign page");
    expect(text).not.toContain("to: wallet");
  });

  it("shows no request it can't decode, and decides none", () => {
    const { whole, text } = open(undefined, view({ action: { kind: "x" } }));
    expect(whole).toBe(false);
    expect(text).not.toContain("{");
  });

  it("shows every Solana instruction with its accounts", () => {
    const data = Buffer.alloc(12);
    data.writeUInt32LE(2, 0);
    data.writeBigUInt64LE(1_500_000n, 4);
    const ix = {
      program_id: SYSTEM,
      data_base64: data.toString("base64"),
      accounts: [{ pubkey: SOL }, { pubkey: SOL2 }],
    };
    const { whole, text } = open(svm([ix]), svmView);
    expect(whole).toBe(true);
    expect(text).toContain(`transfer(lamports: 1500000) on ${SYSTEM}`);
    expect(text).toContain(`from ${SOL}`);
    expect(text).toContain(`to ${SOL2}`);
    const opaque = { ...ix, program_id: SOL2 };
    expect(open(svm([ix, opaque]), svmView).whole).toBe(false);
    expect(open(svm([]), svmView).whole).toBe(false);
  });
});

describe("one decision for a batch", () => {
  const ix = { program_id: ATA, data_base64: "AA==", accounts: [] };
  const one = { payer: SOL, description: "Send", instructions: [ix] };
  const fee = { asset: "native", amount: "5000" };
  const both = {
    ...svm([], { fees: [fee, fee] }),
    transactions: [one, one],
  } as unknown as CommitReview;
  const of = (count: number, state: string) =>
    open(both, { ...svmView, ...batch(count), state } as CommitRefView);

  it("is one card for all of it", () => {
    const { whole, text } = of(2, "awaiting_approval");
    expect(whole).toBe(true);
    expect(text).toContain("Decides all 2, in order");
    expect(text).toContain("2. Send");
  });

  it("is for the sign page when a member is not shown", () => {
    expect(of(3, "awaiting_approval").whole).toBe(false);
  });

  it("is for the sign page when a local key would sign it", () => {
    expect(of(2, "needs_signature").whole).toBe(false);
  });
});

describe("amounts and fees", () => {
  const change = (more: object) =>
    open(
      evm([leg(transfer)], {
        balanceChanges: [
          { account: ME, direction: "out", asset: THEM, amount: "5", ...more },
        ],
      }),
    );

  it("shows the quantity beside a token id", () => {
    const { whole, text } = change({ tokenId: "7", standard: "erc1155" });
    expect(whole).toBe(true);
    expect(text).toContain(`- send 5 token #7 (${THEM})`);
  });

  it("shows a scaled amount and what it was before", () => {
    const { text } = change({
      amount: "1000000",
      decimals: 6,
      symbol: "xSTK",
      uiMultiplier: "10.5",
    });
    expect(text).toContain("- send 10.5 xSTK");
    expect(text).toContain("1 before its ×10.5 scaling");
  });

  it.each([
    ["no decimals", {}],
    ["no direction", { direction: null, decimals: 6 }],
    ["an unreadable scaling", { decimals: 6, uiMultiplier: "many" }],
  ])("decides nothing with %s", (_, more) => {
    expect(change(more).whole).toBe(false);
  });

  it("adds up every fee, and needs one per Solana transaction", () => {
    const fees = [
      { asset: "native", amount: "5000" },
      { asset: "native", amount: "7000" },
    ];
    const ix = { program_id: ATA, data_base64: "AA==", accounts: [] };
    expect(open(svm([ix], { fees }), svmView).text).toContain(
      "Fee ~0.000012 native token",
    );
    expect(open(svm([ix], { fees: [] }), svmView).whole).toBe(false);
  });

  it("shows the most a local signature can cost", () => {
    const { whole, text } = open(evm([leg(transfer)]));
    expect(whole).toBe(true);
    expect(text).toContain("Fee at most 0.0001 native token");
  });

  it.each([
    ["gas units", {}],
    ["no gas", { gas: null }],
    ["a gas estimate", { gas: { units: "50000", nativeCost: "0.0001" } }],
    ["a fee estimate", { fees: [{ asset: "native", amount: "5000" }] }],
  ])("is for the sign page when Aomi's own send has %s", (_, more) => {
    const parked = view({ state: "awaiting_approval", action: null });
    const { whole, text } = open(evm([leg(transfer)], more), parked);
    expect(whole).toBe(false);
    expect(text).toContain("Fee limit not reported");
  });
});

describe("a message", () => {
  const long = `${"a".repeat(400)} then pay‮0x1​\nlast \\u{1}`;

  it("is shown whole, with what a screen hides written out", () => {
    for (const text of [long, toHex(long)]) {
      const card = open(message({ kind: "evm_personal", message: text }));
      expect(card.whole).toBe(true);
      expect(card.text).toContain(
        "then pay\\u{202e}0x1\\u{200b}\nlast \\\\u{1}",
      );
    }
  });

  it("is for the sign page when its bytes are no text", () => {
    expect(
      open(message({ kind: "evm_personal", message: "0xff00ff" })).whole,
    ).toBe(false);
    expect(
      open(message({ kind: "svm_message", message_base64: "//8=" })).whole,
    ).toBe(false);
    expect(
      open(message({ kind: "evm_personal", message: "x" }, { payloads: [] }))
        .whole,
    ).toBe(false);
  });

  it("shows typed data with its deadline", () => {
    const { whole, text } = open(
      message(
        {
          kind: "evm_typed_data",
          typed_data: { primaryType: "Permit", message: { spender: THEM } },
        },
        {
          messageReview: {
            kind: "permit",
            rows: [],
            expires_at: 1_800_000_000,
          },
        },
      ),
    );
    expect(whole).toBe(true);
    expect(text).toContain(`"spender": "${THEM}"`);
    expect(text).toContain("Expires 2027-01-15T08:00:00.000Z");
  });
});

it("draws nothing a terminal acts on", () => {
  const { text } = open(evm([leg(transfer, "Pay\u001b[2K‮")]));
  expect(text).not.toMatch(/[\u001b‮]/);
  const step = {
    title: "Swap\u001b[1A",
    chips: [{ label: "Base\u001b]0;x\u0007" }],
  } as unknown as Parameters<typeof stepLine>[0];
  expect(stepLine(step, false)).not.toMatch(/[\u001b\u0007]/);
});
