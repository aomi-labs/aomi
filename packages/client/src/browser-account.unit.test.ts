// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAomiBrowserGrantManager } from "./oauth";

const savedSessions = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./internal/browser-grant-storage", () => ({
  browserGrantStorage: (key: string) => ({
    load: async () => savedSessions.get(key),
    save: async (value: unknown) => {
      if (value) savedSessions.set(key, structuredClone(value));
      else savedSessions.delete(key);
    },
  }),
}));
const portal = "https://portal.example";
const resource = `${portal}/v1/agent` as const;
// Agent, Pipeline and Account share one `/v1` sign-in; MCP keeps its own.
const apiResource = `${portal}/v1` as const;
const mcpResource = `${portal}/v1/agent/mcp` as const;
afterEach(() => {
  vi.unstubAllGlobals();
  savedSessions.clear();
});

async function fixture(
  input: {
    audience?: string;
    issuer?: string;
    account?: string;
    guest?: boolean;
    persistenceKey?: string;
  } = {},
) {
  const keys = await generateKeyPair("ES256");
  const jwk = await exportJWK(keys.publicKey);
  let owner = input.account ?? "account-b";
  const close = vi.fn();
  const popup = { closed: false, close, location: { href: "about:blank" } };
  let href = "about:blank";
  Object.defineProperty(popup.location, "href", {
    get: () => href,
    set: (url: string) => {
      const query = new URL(url).searchParams;
      href = `https://fuzzer.example/auth/aomi?code=test-code&state=${query.get("state")}`;
    },
  });
  vi.stubGlobal("window", { location: { origin: "https://fuzzer.example" } });
  const fetcher = vi.fn(async function (
    this: unknown,
    url: RequestInfo | URL,
    init?: RequestInit,
  ) {
    expect(this).toBeUndefined();
    if (String(url).endsWith("oauth-authorization-server"))
      return Response.json({
        issuer: `${portal}/api/auth`,
        authorization_endpoint: `${portal}/api/auth/oauth2/authorize`,
        token_endpoint: `${portal}/api/auth/oauth2/token`,
        revocation_endpoint: `${portal}/api/auth/oauth2/revoke`,
        device_authorization_endpoint: `${portal}/api/auth/oauth2/device`,
        jwks_uri: `${portal}/api/auth/jwks`,
        code_challenge_methods_supported: ["S256"],
      });
    if (String(url).endsWith("/jwks"))
      return Response.json({ keys: [{ ...jwk, kid: "test" }] });
    if (String(url).endsWith("/token")) {
      expect(new Headers(init?.headers).get("dpop")).toBeTruthy();
      const token = await new SignJWT({
        "https://aomi.dev/canonical_user_id": owner,
        "https://aomi.dev/principal_class": input.guest ? "guest" : "user",
      })
        .setProtectedHeader({ alg: "ES256", kid: "test" })
        .setIssuer(input.issuer ?? `${portal}/api/auth`)
        .setAudience(
          input.audience ??
            new URLSearchParams(String(init?.body)).get("resource") ??
            resource,
        )
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
      return Response.json({
        access_token: token,
        refresh_token: "test-refresh",
        token_type: "DPoP",
        expires_in: 300,
        scope:
          new URLSearchParams(String(init?.body)).get("scope") ??
          (new URLSearchParams(String(init?.body))
            .get("resource")
            ?.endsWith("/mcp")
            ? "mcp:agent"
            : "agent:read"),
      });
    }
    throw new Error("Unexpected endpoint");
  });
  const manager = await createAomiBrowserGrantManager({
    portalBaseUrl: portal,
    persistenceKey: input.persistenceKey,
    clientId: "fuzzer",
    redirectUri: "https://fuzzer.example/auth/aomi",
    fetch: fetcher,
    closePopup: false,
    popup: () => popup as unknown as Window,
    timeoutMs: 2000,
  });
  return {
    manager,
    close,
    fetcher,
    changeOwner: (next: string) => {
      owner = next;
    },
  };
}

it("signed-out host uses Portal authorization and receives the verified canonical account", async () => {
  const { manager, close, fetcher } = await fixture();
  const token = await manager.tokenProvider({
    resource,
    scopes: ["agent:read"],
  });
  expect(token?.tokenType).toBe("DPoP");
  expect((await manager.grants())[0]?.accountId).toBe("account-b");
  expect(
    fetcher.mock.calls.some(([url]) =>
      String(url).includes("widget/oauth-bootstrap"),
    ),
  ).toBe(false);
  expect(close).not.toHaveBeenCalled();
});
it.each([
  { audience: `${portal}/v1/account` },
  { issuer: "https://foreign.example" },
  { guest: true },
])("rejects an invalid selected identity: %j", async (input) => {
  const { manager } = await fixture(input);
  await expect(
    manager.tokenProvider({ resource, scopes: ["agent:read"] }),
  ).rejects.toThrow();
  expect(await manager.grants()).toEqual([]);
});
it("refresh cannot silently change the admitted account", async () => {
  const { manager, changeOwner } = await fixture();
  await manager.tokenProvider({ resource, scopes: ["agent:read"] });
  changeOwner("account-a");
  await expect(
    manager.tokenProvider({
      resource,
      scopes: ["agent:read"],
      forceRefresh: true,
    }),
  ).rejects.toThrow(/Sign in again/);
  expect((await manager.grants())[0]?.accountId).toBe("account-b");
});

it("restores DPoP credentials without opening a popup and clears durable grants on sign-out", async () => {
  const { manager, fetcher } = await fixture({ persistenceKey: "tab-session" });
  await manager.tokenProvider({ resource, scopes: ["agent:read"] });
  const saved = [...savedSessions.values()][0] as {
    keys: Map<string, CryptoKeyPair>;
  };
  expect(saved.keys.get(apiResource)?.privateKey.extractable).toBe(false);
  const popup = vi.fn();
  const restored = await createAomiBrowserGrantManager({
    portalBaseUrl: portal,
    clientId: "fuzzer",
    redirectUri: "https://fuzzer.example/auth/aomi",
    persistenceKey: "tab-session",
    interactive: false,
    fetch: fetcher,
    popup,
  });
  expect((await restored.grants())[0]?.accountId).toBe("account-b");
  expect(
    await restored.tokenProvider({ resource, scopes: ["agent:read"] }),
  ).toBeTruthy();
  expect(popup).not.toHaveBeenCalled();
  await restored.clear();
  expect(savedSessions.size).toBe(0);
  await expect(
    restored.tokenProvider({ resource, scopes: ["agent:read"] }),
  ).resolves.toBeNull();
  expect(popup).not.toHaveBeenCalled();
});

it("reload rejects a changed canonical account instead of trusting saved labels", async () => {
  const { manager, fetcher, changeOwner } = await fixture({
    persistenceKey: "tab-session",
  });
  await manager.tokenProvider({ resource, scopes: ["agent:read"] });
  changeOwner("other-account");
  const popup = vi.fn();
  const restored = await createAomiBrowserGrantManager({
    portalBaseUrl: portal,
    clientId: "fuzzer",
    redirectUri: "https://fuzzer.example/auth/aomi",
    persistenceKey: "tab-session",
    interactive: false,
    fetch: fetcher,
    popup,
  });
  await expect(restored.grants()).rejects.toThrow(/Sign in again/);
  expect(popup).not.toHaveBeenCalled();
});

function restore(fetcher: typeof fetch) {
  return createAomiBrowserGrantManager({
    portalBaseUrl: portal,
    clientId: "fuzzer",
    redirectUri: "https://fuzzer.example/auth/aomi",
    persistenceKey: "tab-session",
    interactive: false,
    fetch: fetcher,
  });
}

it("drops only the rejected saved grant and restores the other resource", async () => {
  const { manager, fetcher } = await fixture({ persistenceKey: "tab-session" });
  await manager.tokenProvider({ resource, scopes: ["agent:read"] });
  await manager.tokenProvider({
    resource: mcpResource,
    scopes: ["mcp:agent"],
  });
  const restored = await restore(async (url, init) => {
    if (
      String(url).endsWith("/token") &&
      new URLSearchParams(String(init?.body)).get("resource") === apiResource
    )
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    return fetcher(url, init);
  });
  expect((await restored.grants()).map((grant) => grant.resource)).toEqual([
    mcpResource,
  ]);
  const reloaded = await restore(fetcher);
  expect((await reloaded.grants()).map((grant) => grant.resource)).toEqual([
    mcpResource,
  ]);
  await reloaded.clear();
  expect(savedSessions.size).toBe(0);
});

it("removes an account-changing grant while preserving unrelated saved authorization", async () => {
  const { manager, fetcher, changeOwner } = await fixture({
    persistenceKey: "tab-session",
  });
  await manager.tokenProvider({ resource, scopes: ["agent:read"] });
  await manager.tokenProvider({
    resource: mcpResource,
    scopes: ["mcp:agent"],
  });
  changeOwner("changed");
  const restored = await restore(fetcher);
  await expect(restored.grants()).rejects.toThrow(/Sign in again/);
  const saved = [...savedSessions.values()][0] as {
    grants: { resource: string }[];
  };
  expect(saved.grants.map((grant) => grant.resource)).toEqual([
    mcpResource,
  ]);
  changeOwner("account-b");
  const reloaded = await restore(fetcher);
  expect((await reloaded.grants()).map((grant) => grant.resource)).toEqual([
    mcpResource,
  ]);
  await restored.clear();
  expect(savedSessions.size).toBe(0);
});

it("retains saved grants on a transient verification failure and still permits sign-out", async () => {
  const { manager, fetcher } = await fixture({ persistenceKey: "tab-session" });
  await manager.tokenProvider({ resource, scopes: ["agent:read"] });
  const restored = await restore(async (url, init) =>
    String(url).endsWith("/jwks")
      ? new Response(null, { status: 503 })
      : fetcher(url, init),
  );
  await expect(restored.grants()).rejects.toThrow(/Cannot verify/);
  expect(savedSessions.size).toBe(1);
  await restored.clear();
  expect(savedSessions.size).toBe(0);
});
