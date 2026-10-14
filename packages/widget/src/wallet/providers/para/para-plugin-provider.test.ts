import { describe, expect, it } from "vitest";
import { shouldConnectParaEvmSession } from "./para-evm-session";

describe("Para embedded EVM connection", () => {
  it("connects wagmi when auth only produced the synthetic Para session", () => {
    expect(
      shouldConnectParaEvmSession(true, [
        { uid: "para-session", stableId: "para" },
      ]),
    ).toBe(true);
  });

  it("does not reconnect once the real Para wagmi connector is live", () => {
    expect(
      shouldConnectParaEvmSession(true, [
        { uid: "para-connector-uid", stableId: "para" },
      ]),
    ).toBe(false);
  });

  it("does not connect when the Para session is unauthenticated", () => {
    expect(shouldConnectParaEvmSession(false, [])).toBe(false);
  });
});
