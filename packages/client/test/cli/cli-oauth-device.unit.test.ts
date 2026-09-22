import { afterEach, describe, expect, it, vi } from "vitest";

import { signInWithOAuthDevice } from "../../src/cli/oauth-device-auth";

const AGENT_RESOURCE = "https://chat.aomi.dev/v1/agent" as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CLI OAuth device authorization", () => {
  it("registers a public client and preserves exact resource and scopes", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ client_id: "public-client" }))
      .mockResolvedValueOnce(
        Response.json({
          device_code: "device-code",
          user_code: "AOMI-1234",
          verification_uri: "https://chat.aomi.dev/device",
          expires_in: 60,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 300,
          scope: "agent:read offline_access",
          token_type: "Bearer",
        }),
      );

    const resultPromise = signInWithOAuthDevice({
      baseUrl: "https://chat.aomi.dev",
      resource: AGENT_RESOURCE,
      scopes: ["agent:read", "offline_access"],
      fetch: fetchImpl,
      openBrowser: vi.fn(),
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toMatchObject({
      clientId: "public-client",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      resource: AGENT_RESOURCE,
      scopes: ["agent:read", "offline_access"],
    });
    const registration = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(registration).toMatchObject({
      token_endpoint_auth_method: "none",
      resources: [AGENT_RESOURCE],
      scope: "agent:read offline_access",
    });
    expect(registration).not.toHaveProperty("redirect_uris");
    expect(registration).not.toHaveProperty("response_types");
    const deviceBody = new URLSearchParams(
      String(fetchImpl.mock.calls[1]?.[1]?.body),
    );
    expect(deviceBody.get("resource")).toBe(AGENT_RESOURCE);
    const tokenBody = new URLSearchParams(
      String(fetchImpl.mock.calls[2]?.[1]?.body),
    );
    expect(tokenBody.get("resource")).toBe(AGENT_RESOURCE);
  });

  it("reuses a registered client for step-up and honors slow_down", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          device_code: "step-up-code",
          user_code: "AOMI-5678",
          verification_uri: "https://chat.aomi.dev/device",
          expires_in: 60,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "authorization_pending" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "slow_down" }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "elevated-token",
          expires_in: 300,
          scope: "agent:read agent:write payments:submit offline_access",
        }),
      );

    const resultPromise = signInWithOAuthDevice({
      baseUrl: "https://chat.aomi.dev",
      clientId: "existing-client",
      resource: AGENT_RESOURCE,
      scopes: [
        "agent:read",
        "agent:write",
        "payments:submit",
        "offline_access",
      ],
      fetch: fetchImpl,
      openBrowser: vi.fn(),
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.clientId).toBe("existing-client");
    expect(result.accessToken).toBe("elevated-token");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://chat.aomi.dev/api/auth/device/code",
    );
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      "https://chat.aomi.dev/api/auth/oauth2/token",
    );
  });

  it("fails when the device code expires without authorization", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          device_code: "expired-code",
          user_code: "AOMI-9999",
          verification_uri: "https://chat.aomi.dev/device",
          expires_in: 2,
          interval: 1,
        }),
      )
      .mockImplementation(async () =>
        Response.json({ error: "authorization_pending" }, { status: 400 }),
      );

    const resultPromise = signInWithOAuthDevice({
      baseUrl: "https://chat.aomi.dev",
      clientId: "existing-client",
      resource: AGENT_RESOURCE,
      scopes: ["agent:read"],
      fetch: fetchImpl,
      openBrowser: vi.fn(),
    });
    const rejection = resultPromise.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    await expect(rejection).resolves.toMatchObject({
      message: "OAuth device login expired before approval",
    });
  });
});
