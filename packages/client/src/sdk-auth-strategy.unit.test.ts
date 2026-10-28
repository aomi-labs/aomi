import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AomiOAuthGrant,
  AomiOAuthGrantManager,
  AomiOAuthTokenRequest,
} from "./authorization";
import {
  createAomiBrowserGrantManager,
  createAomiDeviceGrantManager,
} from "./oauth";
import { createOAuthAuthRuntime, oauth } from "./sdk/auth";

vi.mock("./oauth", () => ({
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
    // One eager sign-in for both targets, then one lazy call.
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

    expect(requests).toHaveLength(2);
    expect(requests[0]?.scopes).toEqual(
      expect.arrayContaining([
        "agent:read",
        "agent:write",
        "agent:actions:resolve",
        "pipeline:catalog",
        "pipeline:execute",
      ]),
    );
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

  it("shows the device code through onCode and asks for extra scopes only when told", async () => {
    const onCode = vi.fn();
    const runtime = createOAuthAuthRuntime({
      baseUrl,
      fetch,
      strategy: oauth({
        clientId: "managed-client",
        onCode,
        scopes: ["account:apps:read"],
      }),
    });
    await runtime.controller.login();

    const input = vi.mocked(createAomiDeviceGrantManager).mock.calls[0]![0];
    expect(input.scopes).toEqual(
      expect.arrayContaining([
        "agent:write",
        "pipeline:execute",
        "account:apps:read",
      ]),
    );
    expect(input.scopes).not.toContain("account:apps:write");
    await input.onVerification({
      verificationUri: `${baseUrl}/oauth/device`,
      verificationUriComplete: `${baseUrl}/oauth/device?user_code=ABCD`,
      userCode: "ABCD",
      expiresAt: 1,
    });
    expect(onCode).toHaveBeenCalledWith({
      url: `${baseUrl}/oauth/device?user_code=ABCD`,
      code: "ABCD",
      expiresAt: 1,
    });
  });
});
