import { describe, expect, it } from "vitest";
import { walletUserState } from "./user-state";

describe("walletUserState", () => {
  const address = "So11111111111111111111111111111111111111112";

  it("reports can_sign_v1_transaction only for a wallet that signs v1", () => {
    expect(walletUserState({ svm: { address } })?.svm).toEqual({ address });
    expect(
      walletUserState({ svm: { address, canSignV1Transaction: true } })?.svm,
    ).toEqual({ address, capabilities: ["can_sign_v1_transaction"] });
  });
});
