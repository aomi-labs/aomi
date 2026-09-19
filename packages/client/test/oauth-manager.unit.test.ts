import { describe, expect, it, vi } from "vitest";
import {
  AomiOAuthError,
  createAomiOAuthGrantManager,
  type AomiOAuthGrant,
} from "../src/authorization";

const issuer = "https://portal.example/api/auth";
const clientId = "managed-client";
const agentResource = "https://portal.example/v1/agent" as const;
const pipelineResource = "https://portal.example/v1/pipeline" as const;

function grant(
  resource: typeof agentResource | typeof pipelineResource,
  accessToken: string,
): AomiOAuthGrant {
  return {
    issuer,
    clientId,
    accessToken,
    refreshToken: `${accessToken}-refresh`,
    expiresAt: 0,
    resource,
    scopes: resource === agentResource ? ["agent:read"] : ["pipeline:catalog"],
  };
}

describe("Aomi OAuth grant manager", () => {
  it("keeps agent and pipeline grants separate and deduplicates refresh", async () => {
    const refresh = vi.fn(async (current: AomiOAuthGrant) => ({
      ...current,
      accessToken: `${current.accessToken}-fresh`,
      expiresAt: 100_000,
    }));
    const manager = createAomiOAuthGrantManager({
      issuer,
      clientId,
      initial: [grant(agentResource, "agent"), grant(pipelineResource, "pipe")],
      refresh,
      now: () => 1,
    });
    const request = { resource: agentResource, scopes: ["agent:read"] };
    const [left, right] = await Promise.all([
      manager.tokenProvider(request),
      manager.tokenProvider(request),
    ]);
    expect(left?.accessToken).toBe("agent-fresh");
    expect(right?.accessToken).toBe("agent-fresh");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await manager.grants()).map((item) => item.resource)).toEqual([
      pipelineResource,
      agentResource,
    ]);
  });

  it("removes invalid grants and rejects refresh scope expansion", async () => {
    const manager = createAomiOAuthGrantManager({
      issuer,
      clientId,
      initial: [grant(agentResource, "agent")],
      refresh: async (current) => ({
        ...current,
        scopes: [...current.scopes, "agent:write"],
      }),
      now: () => 1,
    });
    await expect(
      manager.tokenProvider({
        resource: agentResource,
        scopes: ["agent:read"],
      }),
    ).rejects.toBeInstanceOf(AomiOAuthError);
    await expect(manager.grants()).resolves.toEqual([]);
  });
});
