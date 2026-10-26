import { describe, expect, it, vi } from "vitest";
import {
  AomiOAuthError,
  createAomiOAuthGrantManager,
  type AomiOAuthGrant,
} from "./authorization";
import { createAomiDeviceGrantManager } from "./oauth";

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

  it("refreshes the whole grant so a narrow request keeps its other scopes", async () => {
    const accountResource = "https://portal.example/v1/account" as const;
    const scopes = [
      "account:credits:read",
      "account:credits:fund",
      "payments:submit",
      "offline_access",
    ];
    // Better Auth reissues exactly the scopes a refresh asks for.
    const refresh = vi.fn(
      async (
        current: AomiOAuthGrant,
        request: { scopes: readonly string[] },
      ) => ({
        ...current,
        accessToken: `${current.accessToken}-fresh`,
        expiresAt: 100_000,
        scopes: [...request.scopes],
      }),
    );
    let now = 1;
    const manager = createAomiOAuthGrantManager({
      issuer,
      clientId,
      initial: [
        {
          issuer,
          clientId,
          accessToken: "account",
          refreshToken: "account-refresh",
          expiresAt: 0,
          resource: accountResource,
          scopes,
        },
      ],
      refresh,
      now: () => now,
    });
    // The balance read lands on an expired token first.
    const read = await manager.tokenProvider({
      resource: accountResource,
      scopes: ["account:credits:read"],
    });
    expect(read?.accessToken).toBe("account-fresh");
    expect(refresh.mock.calls[0]![1].scopes).toEqual(scopes);
    // Checkout must still be covered by the same grant afterwards.
    now = 2;
    const fund = await manager.tokenProvider({
      resource: accountResource,
      scopes: ["account:credits:fund"],
      forceRefresh: true,
    });
    expect(fund?.scopes).toEqual(scopes);
    expect((await manager.grants()).map((item) => item.scopes)).toEqual([
      scopes,
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

describe("createAomiDeviceGrantManager", () => {
  it.each([undefined, "", "  "])(
    "explains how to register when the client ID is %j",
    async (missing) => {
      const fetch = vi.fn();
      await expect(
        createAomiDeviceGrantManager({
          portalBaseUrl: "https://portal.example",
          clientId: missing as unknown as string,
          fetch,
          onVerification: () => {},
        }),
      ).rejects.toThrow(/POST \/api\/auth\/oauth2\/register/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
