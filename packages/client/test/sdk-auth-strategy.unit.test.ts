import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AomiOAuthGrant,
  AomiOAuthGrantManager,
  AomiOAuthTokenRequest,
} from "../src/authorization";
import {
  createAomiBrowserGrantManager,
  createAomiDeviceGrantManager,
} from "../src/oauth";
import { createOAuthAuthRuntime, oauth } from "../src/sdk/auth";

vi.mock("../src/oauth", () => ({
  createAomiBrowserGrantManager: vi.fn(),
  createAomiDeviceGrantManager: vi.fn(),
}));

const baseUrl = "https://chat.aomi.dev";

describe("high-level OAuth strategy", () => {
  const requests: AomiOAuthTokenRequest[] = [];
  const grants: AomiOAuthGrant[] = [];
  const manager: AomiOAuthGrantManager = {
    tokenProvider: vi.fn(async (request) => {
      requests.push(request);
      const grant: AomiOAuthGrant = {
        issuer: `${baseUrl}/api/auth`,
        clientId: "managed-client",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000,
        resource: request.resource,
        scopes: request.scopes,
      };
      grants.push(grant);
      return grant;
    }),
    put: vi.fn(),
    grants: vi.fn(async () => grants),
    revoke: vi.fn(),
    clear: vi.fn(),
  };

  beforeEach(() => {
    requests.length = 0;
    grants.length = 0;
    vi.clearAllMocks();
    vi.mocked(createAomiDeviceGrantManager).mockResolvedValue(manager);
  });

  it("requests refreshable grants for eager and lazy device OAuth", async () => {
    const runtime = createOAuthAuthRuntime({
      baseUrl,
      fetch,
      strategy: oauth({ clientId: "managed-client", onVerification: vi.fn() }),
    });

    await runtime.controller.login({ for: ["agent", "pipeline"] });
    await runtime.tokenProvider({
      resource: `${baseUrl}/v1/agent`,
      scopes: ["agent:read"],
    });

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.scopes).toContain("offline_access");
    }
  });

  it("also keeps browser grants refreshable in memory", async () => {
    vi.mocked(createAomiBrowserGrantManager).mockResolvedValue(manager);
    const runtime = createOAuthAuthRuntime({
      baseUrl,
      fetch,
      strategy: oauth({
        flow: "browser",
        clientId: "managed-client",
        redirectUri: "https://app.example/oauth/callback",
        getWidgetBearer: async () => "widget-session",
      }),
    });

    await runtime.tokenProvider({
      resource: `${baseUrl}/v1/pipeline`,
      scopes: ["pipeline:catalog"],
    });

    expect(requests[0]?.scopes).toEqual(["pipeline:catalog", "offline_access"]);
  });
});
