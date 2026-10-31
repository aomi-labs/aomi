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
  { name: "separate manager", backend: "https://backend.example", manager: "https://manager.example" },
  { name: "backend fallback", backend: "https://backend.example", manager: undefined },
  { name: "origin base paths", backend: "https://backend.example/backend", manager: "https://manager.example/manager" },
])("Build client routing: $name", ({ backend, manager }) => {
  it("keeps vault operations on Backend and control-plane operations on Manager", async () => {
    const request = new Request("https://build.example/api/build/deployments/secrets", {
      headers: { cookie: "aomi_github=browser-session", authorization: "Bearer browser-token" },
    });
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
      if (outgoing.url === `${backend}/api/_internal/secrets?application_id=42`)
        return Response.json({ by_app: { demo: ["API_KEY"] } });
      if (outgoing.url === `${backend}/api/_internal/secrets` && outgoing.method === "POST")
        return Response.json({ handles: { API_KEY: "$SECRET:APP:demo::API_KEY" } });
      if (outgoing.url === `${backend}/api/_internal/secrets` && outgoing.method === "DELETE")
        return Response.json({ removed: true });
      if (outgoing.url === `${manager ?? backend}/api/platforms/server-tags`)
        return Response.json({ server_tags: ["v1"], sdk_version: "1.2.3" });
      return Response.json({ error: `wrong upstream: ${url}` }, { status: 404 });
    })!;
    const client = await managerClient(request, context);

    await expect(client.listAppSecrets({ applicationId: 42 })).resolves.toEqual({ byApp: { demo: ["API_KEY"] } });
    await expect(client.ingestSecrets({ applicationId: 42, app: "demo", secrets: { API_KEY: "test-value" } }))
      .resolves.toEqual({ handles: { API_KEY: "$SECRET:APP:demo::API_KEY" } });
    await expect(client.removeAppSecret({ applicationId: 42, name: "API_KEY" })).resolves.toBe(true);
    await expect(client.serverTags()).resolves.toMatchObject({ serverTags: ["v1"], sdkVersion: "1.2.3" });

    expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: `${backend}/api/_internal/secrets?application_id=42`, method: "GET", body: undefined },
      { url: `${backend}/api/_internal/secrets`, method: "POST", body: { application_id: 42, app: "demo", secrets: { API_KEY: "test-value" } } },
      { url: `${backend}/api/_internal/secrets`, method: "DELETE", body: { application_id: 42, name: "API_KEY" } },
      { url: `${manager ?? backend}/api/platforms/server-tags`, method: "GET", body: undefined },
    ]);
    const publicKey = await importSPKI(DEV_PUBLIC_KEY, "EdDSA");
    for (const call of seen) {
      expect(call.cache).toBe("no-store");
      expect(call.redirect).toBe("manual");
      expect(call.headers.get("cookie")).toBeNull();
      const bearer = call.headers.get("authorization")!.replace(/^Bearer /, "");
      const { payload } = await jwtVerify(bearer, publicKey, { issuer: "aomi-edge", audience: "aomi-backend" });
      expect(payload).toMatchObject({ role: "service", sub: "aomi-edge" });
      expect(payload.exp! - payload.iat!).toBe(300);
    }
  });
});
