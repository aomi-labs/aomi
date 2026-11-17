// @vitest-environment node
import { importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import type { EdgeEnv } from "../env";
import { resetEdgeServices } from "../identity";
import { buildContext } from "./context";
import { managerClient } from "./manager-client";

const DEV_PRIVATE_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "MC4CAQAwBQYDK2VwBCIEIAJez/5pUy9hG5xNVsHP+4GQ6ZgxHDdzFoZ2GwvkHgx/",
  "-----END PRIVATE KEY-----",
].join("\n");
const DEV_PUBLIC_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEAuqXC9aHQt49M938ZGYqDBCvqJn6PZP0GzPArcG9eCCw=",
  "-----END PUBLIC KEY-----",
].join("\n");

beforeEach(resetEdgeServices);

describe.each([
  {
    name: "separate manager",
    backend: "https://backend.example",
    manager: "https://manager.example",
  },
  {
    name: "backend fallback",
    backend: "https://backend.example",
    manager: undefined,
  },
  {
    name: "origin base paths",
    backend: "https://backend.example/backend",
    manager: "https://manager.example/manager",
  },
])("Build client routing: $name", ({ backend, manager }) => {
  it("signs control-plane requests for Manager", async () => {
    const request = new Request(
      "https://build.example/api/build/deployments/secrets",
      {
        headers: {
          cookie: "aomi_github=browser-session",
          authorization: "Bearer browser-token",
        },
      },
    );
    const env: EdgeEnv = {
      BUILD_HOSTS: "build.example",
      BUILD_UPSTREAM_ORIGIN: "https://build-vercel.example",
      BACKEND_ORIGINS: backend,
      MANAGER_ORIGIN: manager,
      EDGE_TOPOLOGY: "default",
      EDGE_SERVICE_PRIVATE_KEY: DEV_PRIVATE_KEY,
    };
    const seen: {
      url: string;
      method: string;
      headers: Headers;
      body: unknown;
      cache?: RequestCache;
      redirect: RequestRedirect;
    }[] = [];
    const context = buildContext(request, env, async (outgoing, init) => {
      const body = await outgoing.text();
      seen.push({
        url: outgoing.url,
        method: outgoing.method,
        headers: outgoing.headers,
        body: body ? JSON.parse(body) : undefined,
        cache: init?.cache,
        redirect: outgoing.redirect,
      });
      const url = new URL(outgoing.url);
      if (url.pathname.endsWith("/user/projects"))
        return Response.json({ projects: [] });
      return Response.json(
        { error: `wrong upstream: ${url}` },
        { status: 404 },
      );
    })!;
    const client = await managerClient(request, context);

    await expect(
      client.listUserProjects({ githubUserId: "42" }),
    ).resolves.toEqual([]);
    expect(
      seen.map(({ url, method, body }) => ({ url, method, body })),
    ).toEqual([
      {
        url: `${manager ?? backend}/api/integrations/github-app/user/projects?github_user_id=42`,
        method: "GET",
        body: undefined,
      },
    ]);
    const publicKey = await importSPKI(DEV_PUBLIC_KEY, "EdDSA");
    for (const call of seen) {
      expect(call.cache).toBe("no-store");
      expect(call.redirect).toBe("manual");
      expect(call.headers.get("cookie")).toBeNull();
      const bearer = call.headers.get("authorization")!.replace(/^Bearer /, "");
      const { payload } = await jwtVerify(bearer, publicKey, {
        issuer: "aomi-edge",
        audience: "aomi-backend",
      });
      expect(payload).toMatchObject({ role: "service", sub: "aomi-edge" });
      expect(payload.exp! - payload.iat!).toBe(300);
    }
  });
});
