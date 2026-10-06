import { describe, expect, it, vi } from "vitest";

import {
  Aomi,
  oauth,
  type AomiOAuthGrant,
  type AomiOAuthGrantStore,
} from "../src";

const baseUrl = "https://chat.aomi.dev";
const issuer = `${baseUrl}/api/auth`;
const clientId = "managed-public-client";

function grant(
  target: "agent" | "pipeline",
  scopes: readonly string[],
): AomiOAuthGrant {
  return {
    issuer,
    clientId,
    accessToken: `${target}-access`,
    refreshToken: `${target}-refresh`,
    expiresAt: Date.now() + 60_000,
    resource: `${baseUrl}/v1/${target}`,
    scopes,
  };
}

function metadata() {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    token_endpoint: `${issuer}/oauth2/token`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
    device_authorization_endpoint: `${issuer}/oauth2/device/code`,
    jwks_uri: `${issuer}/jwks`,
  };
}

describe("Aomi auth facade", () => {
  it("keeps guest setup zero-config", async () => {
    const aomi = new Aomi({
      baseUrl,
      fetch: vi.fn() as unknown as typeof fetch,
    });

    expect(aomi.auth.mode).toBe("guest");
    await expect(aomi.auth.status()).resolves.toEqual({
      mode: "guest",
      authorized: [],
    });
  });

  it("configures OAuth once and lazily reuses stored resource grants", async () => {
    const stored = [
      grant("agent", [
        "agent:read",
        "agent:write",
        "agent:actions:resolve",
        "offline_access",
      ]),
      grant("pipeline", [
        "pipeline:catalog",
        "pipeline:execute",
        "offline_access",
      ]),
    ];
    const save = vi.fn<AomiOAuthGrantStore["save"]>();
    const store: AomiOAuthGrantStore = {
      load: vi.fn(async () => stored),
      save,
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return Response.json(metadata());
      }
      if (url.endsWith("/v1/agent/sessions")) {
        return Response.json({ sessions: [] });
      }
      if (url === `${issuer}/oauth2/revoke`) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const onVerification = vi.fn();
    const aomi = new Aomi({
      baseUrl,
      fetch: fetchImpl as typeof fetch,
      auth: oauth({ clientId, store, onVerification }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      aomi.auth.login({ for: ["agent", "pipeline", "agent"] }),
    ).resolves.toEqual({ mode: "oauth", authorized: ["agent", "pipeline"] });
    await expect(aomi.raw.agent.sessions.list()).resolves.toEqual({
      sessions: [],
    });

    expect(onVerification).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer agent-access");

    await aomi.auth.logout();
    expect(save).toHaveBeenLastCalledWith([]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await expect(aomi.auth.status()).resolves.toEqual({
      mode: "oauth",
      authorized: [],
    });
  });
});
