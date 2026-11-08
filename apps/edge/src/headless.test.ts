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
const ok = () => vi.fn(async (_request: Request) => Response.json({ ok: true }));
afterEach(() => vi.restoreAllMocks());

describe("headless API independent of the Chat hostname", () => {
  it("challenges MCP directly whatever the Chat hosts are", async () => {
    const response = await handleRequest(
      new Request(`${api}/v1/agent/mcp`, { method: "POST" }),
      { ...env, PORTAL_HOSTS: "" },
      never,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `${api}/.well-known/oauth-protected-resource/v1/agent/mcp`,
    );
  });

  it("advertises the API issuer while the Chat issuer differs", async () => {
    const response = await handleRequest(
      new Request(`${api}/.well-known/oauth-protected-resource/v1/pipeline/mcp`),
      env,
      never,
    );
    expect(await response.json()).toMatchObject({
      resource: `${api}/v1/pipeline/mcp`,
      authorization_servers: [`${api}/api/auth`],
    });
  });

  it("serves sign-in pages from the portal upstream", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response("login"));
    await handleRequest(
      new Request(`${api}/oauth/device?user_code=fixture`),
      { ...env, PORTAL_UPSTREAM_ORIGIN: "https://auth-pages.example" },
      fetch,
    );
    expect(fetch.mock.calls[0][0].url).toBe("https://auth-pages.example/oauth/device?user_code=fixture");
  });

  it("keeps Manager traffic on the API router", async () => {
    const fetch = ok();
    await handleRequest(new Request(`${api}/api/platforms`), { ...env, MANAGER_ORIGIN: "https://manager.example" }, fetch);
    expect(new URL(fetch.mock.calls[0][0].url).origin).toBe("https://manager.example");
  });
});

describe("raw backend credentials", () => {
  it("send an app key to the backend verifier", async () => {
    const fetch = ok();
    await handleRequest(new Request(`${api}/api/account/apps`, { headers: { "aomi-app-key": "fixture" } }), env, fetch);
    expect(fetch.mock.calls[0][0].url).toBe("https://backend.example/api/account/apps");
  });

  it("send an internal account assertion to the backend verifier", async () => {
    const { SignJWT, generateKeyPair } = await import("jose");
    const { privateKey } = await generateKeyPair("EdDSA");
    const token = await new SignJWT({}).setProtectedHeader({ alg: "EdDSA" }).setIssuer("aomi-edge").sign(privateKey);
    const fetch = vi.fn(async (_request: Request) => new Response(null, { status: 401 }));
    const response = await handleRequest(new Request(`${api}/api/account`, { headers: { authorization: `Bearer ${token}` } }), env, fetch);
    expect(response.status).toBe(401);
    expect(fetch.mock.calls[0][0].headers.get("authorization")).toBe(`Bearer ${token}`);
  });

  it("never downgrade an invalid bearer to an app key", async () => {
    vi.spyOn(authServer, "authServer").mockReturnValue({ api: { getSession: async () => null } } as unknown as ReturnType<typeof authServer.authServer>);
    const response = await handleRequest(new Request(`${api}/api/account/apps`, { headers: { authorization: "Bearer invalid", "aomi-app-key": "fixture" } }), env, never);
    expect(response.status).toBe(401);
  });
});
