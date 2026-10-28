import { describe, expect, it, vi } from "vitest";
import {
  AomiOAuthError,
  createAomiOAuthGrantManager,
  createMemoryOAuthGrantStore,
  type AomiOAuthGrant,
  type AomiOAuthTokenRequest,
} from "./authorization";
import { createAomiDeviceGrantManager } from "./oauth";

const issuer = "https://portal.example/api/auth";
const clientId = "managed-client";
const agentResource = "https://portal.example/v1/agent" as const;
const pipelineResource = "https://portal.example/v1/pipeline" as const;
const apiResource = "https://portal.example/v1" as const;
const agentMcpResource = "https://portal.example/v1/agent/mcp" as const;

function grant(
  resource: typeof apiResource | typeof agentMcpResource,
  accessToken: string,
  scopes: readonly string[],
): AomiOAuthGrant {
  return {
    issuer,
    clientId,
    accessToken,
    refreshToken: `${accessToken}-refresh`,
    expiresAt: 0,
    resource,
    scopes: [...scopes],
  };
}

describe("Aomi OAuth grant manager", () => {
  it("leaves other clients' grants in a shared store alone", async () => {
    const other = {
      ...grant(apiResource, "other", ["agent:read"]),
      clientId: "cli",
    };
    const store = createMemoryOAuthGrantStore([other]);
    const manager = createAomiOAuthGrantManager({
      issuer,
      clientId,
      store,
      refresh: vi.fn(),
    });
    await manager.put({
      ...grant(apiResource, "mine", ["agent:read"]),
      expiresAt: 9,
    });
    await manager.clear();
    expect((await store.load()).map((saved) => saved.accessToken)).toEqual([
      "other",
    ]);
  });

  it("takes a grant another process rotated instead of dropping it on invalid_grant", async () => {
    const held = grant(apiResource, "old", ["agent:read"]);
    const store = createMemoryOAuthGrantStore([held]);
    const manager = createAomiOAuthGrantManager({
      issuer,
      clientId,
      store,
      refresh: async () => {
        // Meanwhile another process rotated the refresh token.
        await store.save([
          { ...held, accessToken: "new", refreshToken: "r2", expiresAt: 9e9 },
        ]);
        throw new AomiOAuthError("invalid_grant");
      },
      now: () => 1,
    });
    const token = await manager.tokenProvider({
      resource: agentResource,
      scopes: ["agent:read"],
    });
    expect(token?.accessToken).toBe("new");
    expect((await manager.grants()).map((saved) => saved.refreshToken)).toEqual(
      ["r2"],
    );
  });

  it("serves agent and pipeline from one /v1 grant and deduplicates refresh", async () => {
    const refresh = vi.fn(async (current: AomiOAuthGrant) => ({
      ...current,
      accessToken: `${current.accessToken}-fresh`,
      expiresAt: 100_000,
    }));
    const acquire = vi.fn();
    const manager = createAomiOAuthGrantManager({
      issuer,
      clientId,
      initial: [grant(apiResource, "api", ["agent:read", "pipeline:catalog"])],
      acquire,
      refresh,
      now: () => 1,
    });
    const [agent, pipeline] = await Promise.all([
      manager.tokenProvider({
        resource: agentResource,
        scopes: ["agent:read"],
      }),
      manager.tokenProvider({
        resource: pipelineResource,
        scopes: ["pipeline:catalog"],
      }),
    ]);
    expect(agent?.accessToken).toBe("api-fresh");
    expect(pipeline?.accessToken).toBe("api-fresh");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(acquire).not.toHaveBeenCalled();
    expect((await manager.grants()).map((item) => item.resource)).toEqual([
      apiResource,
    ]);
  });

  it("acquires one /v1 sign-in for agent and pipeline, MCP separately", async () => {
    const acquire = vi.fn(
      async (request: AomiOAuthTokenRequest): Promise<AomiOAuthGrant> => ({
        ...grant(
          request.resource as typeof apiResource,
          "fresh",
          request.scopes,
        ),
        expiresAt: 100_000,
      }),
    );
    const manager = createAomiOAuthGrantManager({
      issuer,
      clientId,
      scopes: ["agent:read", "pipeline:catalog", "offline_access"],
      acquire,
      refresh: vi.fn(),
      now: () => 1,
    });

    await manager.tokenProvider({
      resource: agentResource,
      scopes: ["agent:read", "offline_access"],
    });
    await manager.tokenProvider({
      resource: pipelineResource,
      scopes: ["pipeline:catalog", "offline_access"],
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire.mock.calls[0]?.[0]).toMatchObject({
      resource: apiResource,
      scopes: ["agent:read", "pipeline:catalog", "offline_access"],
    });

    // A scope the held sign-in lacks widens it rather than starting another.
    await manager.tokenProvider({
      resource: agentResource,
      scopes: ["agent:write"],
    });
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[1]?.[0]).toMatchObject({
      resource: apiResource,
      scopes: [
        "agent:read",
        "pipeline:catalog",
        "offline_access",
        "agent:write",
      ],
    });

    // MCP keeps its own exact grant, without the sign-in extras.
    await manager.tokenProvider({
      resource: agentMcpResource,
      scopes: ["agent:read"],
    });
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(acquire.mock.calls[2]?.[0]).toMatchObject({
      resource: agentMcpResource,
      scopes: ["agent:read"],
    });

    await manager.revoke(pipelineResource);
    expect((await manager.grants()).map((item) => item.resource)).toEqual([
      agentMcpResource,
    ]);
  });

  it.each([
    ["/v1", agentResource, apiResource],
    ["MCP", agentMcpResource, agentMcpResource],
  ] as const)(
    "removes invalid %s grants and rejects refresh scope expansion",
    async (_label, resource, held) => {
      const manager = createAomiOAuthGrantManager({
        issuer,
        clientId,
        initial: [grant(held, "held", ["agent:read"])],
        refresh: async (current) => ({
          ...current,
          scopes: [...current.scopes, "agent:write"],
        }),
        now: () => 1,
      });
      await expect(
        manager.tokenProvider({ resource, scopes: ["agent:read"] }),
      ).rejects.toBeInstanceOf(AomiOAuthError);
      await expect(manager.grants()).resolves.toEqual([]);
    },
  );
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
