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

  it("does not send capability hints in Direct", () => {
    expect(buildCapabilityHintPayload("direct", selections)).toBeUndefined();
  });
});
