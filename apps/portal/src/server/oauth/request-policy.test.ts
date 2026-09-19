import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindClientResource: vi.fn().mockResolvedValue("already_bound"),
}));

vi.mock("./client-resource-binding", () => ({
  bindAomiPublicClientResource: mocks.bindClientResource,
}));

import {
  enforceAomiOAuthRequestPolicy,
  type AomiOAuthPolicyResult,
} from "./request-policy";

async function expectContinue(
  result: Promise<AomiOAuthPolicyResult>,
): Promise<Request> {
  const settled = await result;
  expect(settled.kind).toBe("continue");
  if (settled.kind !== "continue") throw new Error("unreachable");
  return settled.request;
}

async function expectReject(
  result: Promise<AomiOAuthPolicyResult>,
  status = 400,
): Promise<void> {
  const settled = await result;
  expect(settled.kind).toBe("reject");
  if (settled.kind !== "reject") throw new Error("unreachable");
  expect(settled.response.status).toBe(status);
}

function scopeOf(request: Request): string[] {
  return (new URL(request.url).searchParams.get("scope") ?? "")
    .split(" ")
    .filter(Boolean);
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "postgres://test.invalid/aomi");
  vi.stubEnv("BETTER_AUTH_URL", "https://portal.example");
  mocks.bindClientResource.mockReset().mockResolvedValue("already_bound");
});

afterEach(() => vi.unstubAllEnvs());

describe("OAuth request policy", () => {
  it("requires exactly one exact resource and matching scopes", async () => {
    const authorize = (query: string) =>
      enforceAomiOAuthRequestPolicy(
        new Request(
          `https://portal.example/api/auth/oauth2/authorize?${query}`,
        ),
      );
    await expectContinue(
      authorize(
        new URLSearchParams({
          resource: "https://portal.example/v1/agent",
          scope: "agent:read",
        }).toString(),
      ),
    );
    await expectReject(authorize("scope=agent%3Aread"));
    const multiple = new URLSearchParams({ scope: "agent:read" });
    multiple.append("resource", "https://portal.example/v1/agent");
    multiple.append("resource", "https://portal.example/v1/agent/mcp");
    await expectReject(authorize(multiple.toString()));
    await expectReject(
      authorize(
        new URLSearchParams({
          resource: "https://portal.example/v1/agent",
          scope: "pipeline:execute",
        }).toString(),
      ),
    );
  });

  it("allows a resource-bound refresh without repeating resource", async () => {
    await expectContinue(
      enforceAomiOAuthRequestPolicy(
        new Request("https://portal.example/api/auth/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "grant_type=refresh_token&refresh_token=opaque-refresh-token",
        }),
      ),
    );
  });

  it("limits unauthenticated DCR to an exact MCP resource", async () => {
    const register = (resource: string) =>
      enforceAomiOAuthRequestPolicy(
        new Request("https://portal.example/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            resources: [resource],
            scope: "agent:read mcp:agent",
          }),
        }),
      );
    await expectContinue(register("https://portal.example/v1/agent/mcp"));
    await expectReject(
      register(`https://portal.example/${["agent", "mcp"].join("/")}`),
    );
    await expectReject(register("https://portal.example/v1/agent"));
  });

  it("accepts RFC 7591 registration that declares no resource", async () => {
    // The payload Codex, Claude Code, and Cursor actually send. RFC 7591 has
    // no resource field; the resource arrives later on authorize and token.
    const request = await expectContinue(
      enforceAomiOAuthRequestPolicy(
        new Request("https://portal.example/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_name: "codex",
            redirect_uris: ["http://localhost:1455/auth/callback"],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }),
        }),
      ),
    );
    await expect(request.json()).resolves.toMatchObject({
      redirect_uris: ["http://localhost:1455/auth/callback"],
    });
  });

  it("normalizes redirect URIs before Better Auth persists them", async () => {
    const request = await expectContinue(
      enforceAomiOAuthRequestPolicy(
        new Request("https://portal.example/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            redirect_uris: [
              " HTTP://127.0.0.1:49152/a/../callback?x=1 ",
              "http://127.0.0.1:49152/callback?x=1",
            ],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }),
        }),
      ),
    );

    await expect(request.json()).resolves.toMatchObject({
      redirect_uris: ["http://127.0.0.1:49152/callback?x=1"],
    });
  });

  it("requires an explicit public token endpoint authentication method", async () => {
    await expectReject(
      enforceAomiOAuthRequestPolicy(
        new Request("https://portal.example/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          }),
        }),
      ),
    );
  });

  it.each([
    ["agent", "https://portal.example/v1/agent", "agent:read offline_access"],
    [
      "pipeline",
      "https://portal.example/v1/pipeline",
      "pipeline:catalog offline_access",
    ],
  ])(
    "accepts a public %s REST device client",
    async (_name, resource, scope) => {
      await expectContinue(
        enforceAomiOAuthRequestPolicy(
          new Request("https://portal.example/api/auth/oauth2/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              client_name: "Aomi CLI",
              token_endpoint_auth_method: "none",
              grant_types: [
                "urn:ietf:params:oauth:grant-type:device_code",
                "refresh_token",
              ],
              resources: [resource],
              scope,
            }),
          }),
        ),
      );
    },
  );

  it("rejects mixed grants, mixed resources, and confidential device clients", async () => {
    const register = (body: Record<string, unknown>) =>
      enforceAomiOAuthRequestPolicy(
        new Request("https://portal.example/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token_endpoint_auth_method: "none",
            grant_types: [
              "urn:ietf:params:oauth:grant-type:device_code",
              "refresh_token",
            ],
            resources: ["https://portal.example/v1/agent"],
            scope: "agent:read",
            ...body,
          }),
        }),
      );

    await expectReject(
      register({
        grant_types: [
          "authorization_code",
          "urn:ietf:params:oauth:grant-type:device_code",
          "refresh_token",
        ],
      }),
      401,
    );
    await expectReject(
      register({
        resources: [
          "https://portal.example/v1/agent",
          "https://portal.example/v1/pipeline",
        ],
      }),
    );
    await expectReject(
      register({ token_endpoint_auth_method: "client_secret_basic" }),
    );
    await expectReject(
      register({ resources: ["https://portal.example/v1/agent/mcp"] }),
    );
  });

  it.each([
    ["non-array", "http://127.0.0.1:49152/callback"],
    ["relative", ["/callback"]],
    ["credentials", ["http://user@127.0.0.1:49152/callback"]],
    ["empty credentials", ["http://@127.0.0.1:49152/callback"]],
    ["fragment", ["http://127.0.0.1:49152/callback#done"]],
    ["empty fragment", ["http://127.0.0.1:49152/callback#"]],
  ])(
    "rejects %s redirect metadata before persistence",
    async (_name, value) => {
      await expectReject(
        enforceAomiOAuthRequestPolicy(
          new Request("https://portal.example/api/auth/oauth2/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              redirect_uris: value,
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            }),
          }),
        ),
      );
    },
  );

  it("removes an empty query delimiter while normalizing registration", async () => {
    const request = await expectContinue(
      enforceAomiOAuthRequestPolicy(
        new Request("https://portal.example/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            redirect_uris: ["http://127.0.0.1:49152/callback?"],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }),
        }),
      ),
    );

    await expect(request.json()).resolves.toMatchObject({
      redirect_uris: ["http://127.0.0.1:49152/callback"],
    });
  });

  // The scope list Codex actually sends, captured from a real `codex mcp login`.
  // It is the authorization server's whole `scopes_supported` — clients build
  // the request from AS metadata, not from the resource metadata and not from
  // the registration response, so it necessarily spans every resource plus the
  // OIDC scopes. Rejecting it made MCP login impossible; it must be narrowed to
  // the one resource the request names.
  const CODEX_SCOPES =
    "agent:read agent:write agent:actions:resolve mcp:agent payments:submit " +
    "custody:delegate pipeline:catalog pipeline:execute mcp:pipeline openid " +
    "profile email offline_access";

  const authorizeWith = (resource: string, scope: string) =>
    enforceAomiOAuthRequestPolicy(
      new Request(
        `https://portal.example/api/auth/oauth2/authorize?${new URLSearchParams(
          { resource, scope },
        ).toString()}`,
      ),
    );

  it("narrows the scope an MCP client sends to the resource it named", async () => {
    const agent = await expectContinue(
      authorizeWith("https://portal.example/v1/agent/mcp", CODEX_SCOPES),
    );
    expect(scopeOf(agent).sort()).toEqual(
      [
        "agent:actions:resolve",
        "agent:read",
        "agent:write",
        "custody:delegate",
        "mcp:agent",
        "offline_access",
        "payments:submit",
      ].sort(),
    );

    const pipeline = await expectContinue(
      authorizeWith("https://portal.example/v1/pipeline/mcp", CODEX_SCOPES),
    );
    expect(scopeOf(pipeline).sort()).toEqual(
      [
        "custody:delegate",
        "mcp:pipeline",
        "offline_access",
        "payments:submit",
        "pipeline:catalog",
        "pipeline:execute",
      ].sort(),
    );
  });

  it("binds a resource-less public client on first authorize and rejects widening", async () => {
    const request = new Request(
      `https://portal.example/api/auth/oauth2/authorize?${new URLSearchParams({
        client_id: "public-client",
        resource: "https://portal.example/v1/pipeline/mcp",
        scope: "pipeline:catalog mcp:pipeline",
      })}`,
    );
    await expectContinue(enforceAomiOAuthRequestPolicy(request));
    expect(mocks.bindClientResource).toHaveBeenCalledWith({
      clientId: "public-client",
      resource: "https://portal.example/v1/pipeline/mcp",
    });

    mocks.bindClientResource.mockResolvedValueOnce("resource_conflict");
    await expectReject(enforceAomiOAuthRequestPolicy(request));
  });

  it("never lets a narrowed grant cross resources or carry identity scopes", async () => {
    for (const resource of [
      "https://portal.example/v1/agent/mcp",
      "https://portal.example/v1/pipeline/mcp",
    ]) {
      const scopes = scopeOf(
        await expectContinue(authorizeWith(resource, CODEX_SCOPES)),
      );
      const foreign = resource.includes("/agent/") ? "pipeline" : "agent";
      expect(scopes.some((s) => s.startsWith(foreign))).toBe(false);
      expect(scopes).not.toContain("mcp:" + foreign);
      for (const identity of ["openid", "profile", "email"]) {
        expect(scopes).not.toContain(identity);
      }
    }
  });

  it("rejects when nothing requested is usable for the resource", async () => {
    await expectReject(
      authorizeWith("https://portal.example/v1/agent/mcp", "pipeline:execute"),
    );
  });

  it("leaves an already-valid request untouched", async () => {
    const request = await expectContinue(
      authorizeWith(
        "https://portal.example/v1/agent/mcp",
        "agent:read mcp:agent",
      ),
    );
    expect(scopeOf(request)).toEqual(["agent:read", "mcp:agent"]);
  });
});
