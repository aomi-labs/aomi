import { expect, it } from "vitest";
import { resolveAgentIdentity } from "./agent-identity";
it("uses a hosted agent's own display name without borrowing another publisher's artwork", () => {
  const result = resolveAgentIdentity({
    agent_id: 7,
    agent: "alice/aave",
    display_name: "Alice's agent",
    metadata: {},
  });
  expect(result.displayName).toBe("Alice's agent");
  expect(result.id).toBe("alice/aave");
  expect(result.brandId).toBe("");
  expect(resolveAgentIdentity("aave").displayName).toBe("Aave");
});
