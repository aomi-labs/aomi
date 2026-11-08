// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as authServer from "./auth/server";
import { handleRequest } from "./handler";
import type { EdgeEnv } from "./env";

const api = "https://api.aomi.dev";
const env = {
  NODE_ENV: "test",
  HEADLESS_API_ORIGIN: api,
  BETTER_AUTH_URL: "https://chat.aomi.dev",
  PORTAL_HOSTS: "aomi.chat",
  BACKEND_ORIGINS: "https://backend.example",
  API_SERVER_ORIGIN: "https://agent.example",
} as EdgeEnv;
const never = vi.fn(async () => {
  throw new Error("headless auth must not call a frontend");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("headless API independent of the Chat hostname", () => {
  it.each(["chat.aomi.dev", "aomi.chat", ""])(
    "challenges MCP directly while Chat hosts are %s",
    async (hosts) => {
      const response = await handleRequest(
        new Request(`${api}/v1/agent/mcp`, { method: "POST" }),
        { ...env, PORTAL_HOSTS: hosts },
        never,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        `${api}/.well-known/oauth-protected-resource/v1/agent/mcp`,
      );
      expect(response.headers.has("location")).toBe(false);
    },
  );

  it("advertises API resources and issuer even when the configured Chat issuer moves", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://aomi.chat");
    const response = await handleRequest(
      new Request(
        `${api}/.well-known/oauth-protected-resource/v1/pipeline/mcp`,
      ),
      env,
      never,
    );
    expect(response.status).toBe(200);
    const metadata = await response.json();
    expect(metadata.resource).toBe(`${api}/v1/pipeline/mcp`);
    expect(metadata.authorization_servers).toEqual([`${api}/api/auth`]);
  });
});

describe("headless route boundaries", () => {
  it("keeps venue discovery and raw Manager traffic on the API router", async () => {
    const fetch = vi.fn(async (_request: Request) => Response.json({ ok: true }));
    const response = await handleRequest(
      new Request(`${api}/api/platforms`),
      { ...env, MANAGER_ORIGIN: "https://manager.example" },
      fetch,
    );
    expect(response.status).toBe(200);
    expect(new URL((fetch.mock.calls[0][0] as Request).url).origin).toBe(
      "https://manager.example",
    );
  });
  it("serves login pages at the API host through a stable upstream alias", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response("login"));
    const response = await handleRequest(
      new Request(`${api}/oauth/device?user_code=fixture`),
      { ...env, HEADLESS_AUTH_UPSTREAM_ORIGIN: "https://auth-pages.example" },
      fetch,
    );
    expect(response.status).toBe(200);
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toBe(
      "https://auth-pages.example/oauth/device?user_code=fixture",
    );
    expect(request.headers.get("x-forwarded-host")).toBe("api.aomi.dev");
  });
  it("does not attach the auth surface to an unconfigured host", async () => {
    const response = await handleRequest(
      new Request("https://other.example/v1/agent/mcp", { method: "POST" }),
      env,
      never,
    );
    expect(response.status).toBe(404);
  });
});


describe("existing raw backend credentials", () => {
  it("retains the backend verifier for an app-key request", async () => {
    const fetch = vi.fn(async (_request: Request) => Response.json({ ok: true }));
    const response = await handleRequest(new Request(`${api}/api/account/apps`, { headers: { "aomi-app-key": "fixture" } }), env, fetch);
    expect(response.status).toBe(200);
    expect(fetch.mock.calls[0][0].url).toBe("https://backend.example/api/account/apps");
    expect(fetch.mock.calls[0][0].headers.get("aomi-app-key")).toBe("fixture");
  });
  it("retains backend signature validation for an internal account assertion", async () => {
    const { SignJWT, generateKeyPair } = await import("jose");
    const { privateKey } = await generateKeyPair("EdDSA");
    const token = await new SignJWT({}).setProtectedHeader({ alg: "EdDSA" }).setIssuer("aomi-edge").sign(privateKey);
    const fetch = vi.fn(async (_request: Request) => new Response(null, { status: 401 }));
    const response = await handleRequest(new Request(`${api}/api/account`, { headers: { authorization: `Bearer ${token}` } }), env, fetch);
    expect(response.status).toBe(401);
    expect(fetch.mock.calls[0][0].headers.get("authorization")).toBe(`Bearer ${token}`);
  });
  it("does not downgrade an invalid explicit credential to an app key", async () => {
    vi.spyOn(authServer, "authServer").mockReturnValue({ api: { getSession: async () => null } } as unknown as ReturnType<typeof authServer.authServer>);
    const response = await handleRequest(new Request(`${api}/api/account/apps`, { headers: { authorization: "Bearer invalid", "aomi-app-key": "fixture" } }), env, never);
    expect(response.status).toBe(401);
  });
});


it("gives a frontend alias the retained canonical Chat identity", async () => {
  const legacy = "https://chat.aomi.dev";
  const response = await handleRequest(new Request("https://aomi.chat/.well-known/oauth-protected-resource/v1/agent/mcp"), {
    ...env, BETTER_AUTH_URL: legacy, PORTAL_HOSTS: "chat.aomi.dev,aomi.chat", PORTAL_UPSTREAM_ORIGIN: "https://pages.example",
  }, never);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ resource: `${legacy}/v1/agent/mcp`, authorization_servers: [`${legacy}/api/auth`] });
});
