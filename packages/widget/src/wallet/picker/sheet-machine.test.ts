import { describe, expect, it } from "vitest";
import { CLOSED_SHEET, sheetReducer, type SheetState } from "./sheet-machine";

const rabby = {
  family: "evm" as const,
  address: "0xda65000000000000000000000000000000003cf0",
  brand: "Rabby",
};
const offer = {
  ticket: "t1",
  other: {
    name: "0xdA65…3CF0",
    createdAt: "2026-09-12T00:00:00Z",
    chats: 12,
    wallets: 2,
    credits: "420",
    dropped: [],
  },
};

function run(...events: Parameters<typeof sheetReducer>[1][]): SheetState {
  return events.reduce(sheetReducer, CLOSED_SHEET);
}

describe("wallet sheet steps", () => {
  it("goes from choose straight to connect for a one-chain wallet", () => {
    expect(
      run(
        { type: "open", mode: "sign-in" },
        { type: "pick", wallet: "rabby", brand: "Rabby", families: ["evm"] },
      ),
    ).toEqual({ step: "connecting", mode: "sign-in", brand: "Rabby" });
  });

  it("asks for the chain first for a two-chain wallet", () => {
    expect(
      run(
        { type: "open", mode: "add" },
        {
          type: "pick",
          wallet: "phantom",
          brand: "Phantom",
          families: ["evm", "svm"],
        },
      ),
    ).toEqual({
      step: "chain",
      mode: "add",
      wallet: "phantom",
      brand: "Phantom",
    });
  });

  it("signs right after connect, and a dismissed prompt falls back to Verify", () => {
    const signing = run(
      { type: "open", mode: "sign-in" },
      { type: "connect", brand: "Rabby" },
      { type: "sign", target: rabby },
    );
    expect(signing).toEqual({
      step: "signing",
      mode: "sign-in",
      target: rabby,
    });
    expect(sheetReducer(signing, { type: "verify", target: rabby })).toEqual({
      step: "verify",
      mode: "sign-in",
      target: rabby,
    });
  });

  it("offers a merge when the signature reveals another account", () => {
    expect(
      run(
        { type: "open", mode: "add" },
        { type: "sign", target: rabby },
        { type: "merge", target: rabby, offer },
      ),
    ).toEqual({ step: "merge", target: rabby, offer });
  });

  it("shows a detected address only when the sheet is idle", () => {
    expect(run({ type: "detected", target: rabby, previous: "0x1" })).toEqual({
      step: "detected",
      target: rabby,
      previous: "0x1",
    });
    const busy = run(
      { type: "open", mode: "add" },
      { type: "connect", brand: "MetaMask" },
    );
    expect(sheetReducer(busy, { type: "detected", target: rabby })).toBe(busy);
  });

  it("returns to the list with the reason a connect failed", () => {
    expect(
      run(
        { type: "open", mode: "add" },
        { type: "connect", brand: "Rabby" },
        { type: "back", error: "Couldn’t connect Rabby." },
      ),
    ).toEqual({
      step: "choose",
      mode: "add",
      error: "Couldn’t connect Rabby.",
    });
  });
});
