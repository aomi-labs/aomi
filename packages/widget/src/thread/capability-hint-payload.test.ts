import { describe, expect, it } from "vitest";
import { buildCapabilityHintPayload } from "./capability-hint-payload";

const selections = [
  { kind: "app" as const, id: "name:uniswap" },
  { kind: "chain" as const, id: "eip155:8453" },
];

describe("buildCapabilityHintPayload", () => {
  it("keeps selections as hints in Auto", () => {
    expect(buildCapabilityHintPayload("auto", selections)).toEqual({
      capabilities: selections,
    });
  });

  it("keeps a tagged wallet's name beside its w_N id", () => {
    expect(
      buildCapabilityHintPayload("auto", [
        { kind: "wallet", id: "w_12", label: "Trading" },
        { kind: "chain", id: "eip155:8453", label: "Base" },
      ]),
    ).toEqual({
      capabilities: [
        { kind: "wallet", id: "w_12", label: "Trading" },
        { kind: "chain", id: "eip155:8453" },
      ],
    });
  });

  it("gives a grouped wallet's every address id as a hint", () => {
    expect(
      buildCapabilityHintPayload("auto", [
        {
          kind: "wallet",
          id: "w_3",
          walletIds: ["w_3", "w_4"],
          label: "Privy",
        },
      ]),
    ).toEqual({
      capabilities: [
        { kind: "wallet", id: "w_3", label: "Privy" },
        { kind: "wallet", id: "w_4", label: "Privy" },
      ],
    });
  });

  it("does not send capability hints in Direct", () => {
    expect(buildCapabilityHintPayload("direct", selections)).toBeUndefined();
  });
});
