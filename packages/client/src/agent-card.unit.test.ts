import { describe, expect, it } from "vitest";
import { normalizeAgentCard, agentIdentityKey } from "./agent-card";
describe("agent key resolution cards", () => {
  it("retains canonical slugs and exact identities without merging publishers", () => {
    const first = normalizeAgentCard({
      agent_id: 7,
      agent: "alice/venue",
      display_name: "Venue",
      metadata: { fundedModelOnly: false },
    })!;
    const second = normalizeAgentCard({
      agent_id: 8,
      agent: "bob/venue",
      display_name: "Venue",
      metadata: {},
    })!;
    expect(first.agent).toBe("alice/venue");
    expect(agentIdentityKey(first)).not.toBe(agentIdentityKey(second));
    expect(normalizeAgentCard({ name: "venue" })).toBeNull();
  });
});
