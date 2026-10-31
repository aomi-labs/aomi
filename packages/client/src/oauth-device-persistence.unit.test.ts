import { describe, expect, it, vi } from "vitest";
import { createMemoryOAuthGrantStore, type AomiOAuthGrant } from "./authorization";
import { createAomiDeviceGrantManager } from "./oauth";

const origin = "https://chat.example";
const grant: AomiOAuthGrant = {
  issuer: `${origin}/api/auth`,
  clientId: "saved-client",
  resource: `${origin}/v1`,
  accessToken: "saved-token",
  refreshToken: "saved-refresh",
  expiresAt: Date.now() + 3_600_000,
  scopes: ["agent:read"],
};

function transport() {
  return vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes(".well-known")) return Response.json({
      issuer: grant.issuer,
      authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
      token_endpoint: `${origin}/api/auth/oauth2/token`,
      revocation_endpoint: `${origin}/api/auth/oauth2/revoke`,
      device_authorization_endpoint: `${origin}/api/auth/device/code`,
      jwks_uri: `${origin}/api/auth/jwks`,
      registration_endpoint: `${origin}/api/auth/oauth2/register`,
    });
    if (path.endsWith("/register")) return Response.json({ client_id: "new-client" });
    throw new Error(`Unexpected interactive request: ${path}`);
  });
}

describe("persisted device client identity", () => {
  it.each(["store", "initial"] as const)("restores %s grants without registering or asking for approval", async (source) => {
    const fetch = transport();
    const onVerification = vi.fn();
    const manager = await createAomiDeviceGrantManager({
      portalBaseUrl: origin,
      fetch,
      onVerification,
      ...(source === "store" ? { store: createMemoryOAuthGrantStore([grant]) } : { initial: [grant] }),
    });
    expect(await manager.tokenProvider({ resource: `${origin}/v1/agent`, scopes: ["agent:read"] })).toMatchObject({ accessToken: "saved-token" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onVerification).not.toHaveBeenCalled();
  });

  it.each([
    { issuer: "https://other.example/api/auth" },
    { subject: "another-user" },
    { resource: `${origin}/v1/agent/mcp` as const },
    { tokenType: "DPoP" as const },
  ])("does not reuse a different grant context: %j", async (different) => {
    const fetch = transport();
    const manager = await createAomiDeviceGrantManager({
      portalBaseUrl: origin, fetch, onVerification: vi.fn(),
      store: createMemoryOAuthGrantStore([{ ...grant, ...different }]),
    });
    expect(await manager.grants()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honors an explicit client instead of a saved client", async () => {
    const fetch = transport();
    const manager = await createAomiDeviceGrantManager({
      portalBaseUrl: origin, clientId: "explicit", fetch, onVerification: vi.fn(),
      store: createMemoryOAuthGrantStore([grant]),
    });
    expect(await manager.grants()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
