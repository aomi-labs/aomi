// @vitest-environment node
import { GitHubSessionSigner } from "@aomi-labs/account/build-session";
import { importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import type { EdgeEnv } from "../env";
import { resetEdgeServices } from "../identity";
import { sha256Hex } from "../kernel/crypto";
import type { FetchLike } from "../kernel/proxy";
import type { ApiKeyStore } from "./api-keys";
import { buildContext } from "./context";
import { handleBuildRequest } from "./routes";

const BUILD = "https://build.example";
const MANAGER = "https://manager.example";
const SECRET = "build-session-secret-for-tests";
const ALICE = "4242";
const PUBLISH_KEY = `aomi_key_${"p".repeat(43)}`;
const OBSERVE_KEY = `aomi_key_${"o".repeat(43)}`;

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

const env: EdgeEnv = {
  BUILD_HOSTS: "build.example",
  BUILD_UPSTREAM_ORIGIN: "https://build-vercel.example",
  BUILD_SESSION_SECRET: SECRET,
  BACKEND_ORIGINS: "https://backend.example",
  MANAGER_ORIGIN: MANAGER,
  EDGE_TOPOLOGY: "default",
  EDGE_SERVICE_PRIVATE_KEY: DEV_PRIVATE_KEY,
};

type Seen = { url: string; headers: Headers; body: Uint8Array };
let seen: Seen[];

const upstream: FetchLike = async (request) => {
  seen.push({ url: request.url, headers: request.headers, body: new Uint8Array(await request.arrayBuffer()) });
  return Response.json({ package: "alice/price", release: { number: 1 }, live: null, verified: false }, { status: 201 });
};

async function keyStore(): Promise<ApiKeyStore> {
  const grants = new Map([
    [await sha256Hex(PUBLISH_KEY), { id: 1, builderId: ALICE, capabilities: ["package:publish"] }],
    [await sha256Hex(OBSERVE_KEY), { id: 2, builderId: ALICE, capabilities: ["project:observe"] }],
  ]);
  return {
    create: () => Promise.reject(new Error("unused")),
    list: async () => [],
    revoke: async () => false,
    find: async (hash) => grants.get(hash) ?? null,
    touch: async () => undefined,
  };
}

async function build(path: string, init: RequestInit): Promise<Response> {
  const request = new Request(`${BUILD}${path}`, init);
  return handleBuildRequest(request, { ...buildContext(request, env, upstream)!, keys: await keyStore() });
}

const claims = async (call: Seen) =>
  (
    await jwtVerify(call.headers.get("authorization")!.replace(/^Bearer /, ""), await importSPKI(DEV_PUBLIC_KEY, "EdDSA"), {
      issuer: "aomi-edge",
      audience: "aomi-backend",
    })
  ).payload;

beforeEach(() => {
  seen = [];
  resetEdgeServices();
});

describe("release routes", () => {
  it("forwards a key's tar to the manager unchanged, with the key's builder bearer", async () => {
    const tar = new Uint8Array(4096).map((_, index) => index % 251);
    const response = await build("/api/build/packages/price/releases", {
      method: "POST",
      headers: {
        authorization: `Bearer ${PUBLISH_KEY}`,
        "content-type": "application/x-tar",
        "x-aomi-source-commit": "abc1234",
        cookie: "aomi_github=ignored",
      },
      body: tar,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ package: "alice/price", release: { number: 1 } });

    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call.url).toBe(`${MANAGER}/api/packages/price/releases`);
    expect(call.body).toEqual(tar);
    expect(call.headers.get("content-type")).toBe("application/x-tar");
    expect(call.headers.get("x-aomi-source-commit")).toBe("abc1234");
    expect(call.headers.get("cookie")).toBeNull();
    expect(call.headers.get("authorization")).not.toContain(PUBLISH_KEY);
    expect(await claims(call)).toMatchObject({
      sub: ALICE,
      role: "user",
      scope: "package:publish",
      resource: `${BUILD}/api/build`,
      auth_source: "api_key",
      principal_class: "builder",
    });
  });

  it("refuses a key without the route's capability before any upstream call", async () => {
    const promote = await build("/api/build/packages/price/promote", {
      method: "POST",
      headers: { authorization: `Bearer ${PUBLISH_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ release: 1, expected_live: null }),
    });
    expect(promote.status).toBe(403);
    expect(await promote.json()).toEqual({ error: "insufficient_scope" });
    const publish = await build("/api/build/agents/hoodit/configs", {
      method: "POST",
      headers: { authorization: `Bearer ${OBSERVE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ root: "", files: {} }),
    });
    expect(publish.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("answers 413 for a body over 10 MB, declared or not", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const headers = { authorization: `Bearer ${PUBLISH_KEY}`, "content-type": "application/x-tar" };
    const declared = await build("/api/build/packages/price/releases", { method: "POST", headers, body: big });
    expect(declared.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big.subarray(0, 6 * 1024 * 1024));
        controller.enqueue(big.subarray(6 * 1024 * 1024));
        controller.close();
      },
    });
    const streamed = await build("/api/build/packages/price/releases", {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({ error: "too_large" });
    expect(seen).toEqual([]);
  });

  it("sends a CLI session as a builder bearer holding the release capabilities", async () => {
    const cli = await new GitHubSessionSigner(SECRET).issueCliSession({ githubUserId: ALICE, githubLogin: "alice" });
    const response = await build("/api/build/agents/hoodit/configs", {
      method: "GET",
      headers: { authorization: `Bearer ${cli}` },
    });
    expect(response.status).toBe(201);
    expect(seen.map((call) => call.url)).toEqual([`${MANAGER}/api/agents/hoodit/configs`]);
    expect(await claims(seen[0])).toMatchObject({
      sub: ALICE,
      role: "user",
      scope: "package:publish package:promote agent:publish agent:promote package:secrets",
      auth_source: "cli_session",
      principal_class: "builder",
    });
  });

  it("forwards the builder reads with a builder bearer and no capability", async () => {
    for (const path of ["/api/build/publishers/me", "/api/build/agents/hoodit", "/api/build/packages/trade"]) {
      const response = await build(path, { method: "GET", headers: { authorization: `Bearer ${OBSERVE_KEY}` } });
      expect(response.status).toBe(201);
    }
    expect(seen.map((call) => call.url)).toEqual([
      `${MANAGER}/api/publishers/me`,
      `${MANAGER}/api/agents/hoodit`,
      `${MANAGER}/api/packages/trade`,
    ]);
    for (const call of seen) {
      expect(call.headers.get("authorization")).not.toContain(OBSERVE_KEY);
      expect(await claims(call)).toMatchObject({ sub: ALICE, scope: "project:observe", auth_source: "api_key" });
    }
  });

  it("holds a package's builder secret writes to package:secrets", async () => {
    const put = await build("/api/build/packages/trade/secrets/GMGN_API_KEY", {
      method: "PUT",
      headers: { authorization: `Bearer ${PUBLISH_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ value: "secret-value" }),
    });
    expect(put.status).toBe(403);
    expect(seen).toEqual([]);
    const session = await new GitHubSessionSigner(SECRET).issueSession({ githubUserId: ALICE, githubLogin: "alice" });
    const set = await build("/api/build/packages/trade/secrets/GMGN_API_KEY", {
      method: "PUT",
      headers: { cookie: `aomi_github=${session}`, origin: BUILD, "content-type": "application/json" },
      body: JSON.stringify({ value: "secret-value" }),
    });
    expect(set.status).toBe(201);
    expect(seen.map((call) => call.url)).toEqual([`${MANAGER}/api/packages/trade/secrets/GMGN_API_KEY`]);
    expect(new TextDecoder().decode(seen[0].body)).toBe(JSON.stringify({ value: "secret-value" }));
    expect(await claims(seen[0])).toMatchObject({ auth_source: "session" });
  });
});
