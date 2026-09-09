import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mintAgentApiBearer: vi.fn() }));

vi.mock("@aomi-labs/account", () => ({
  mintAgentApiBearer: mocks.mintAgentApiBearer,
}));

import {
  configuredAgentApiUrl,
  proxyAgentApi,
  proxyAgentApiDiscovery,
} from "./agent-api-proxy";

const principal = {
  canonicalUserId: "canonical-user",
  scopes: ["agent:write", "payments:submit"],
  resource: "https://portal.example/v1/agent",
  authSource: "oauth" as const,
  principalClass: "user" as const,
  clientId: "client-1",
};

describe("Agent API proxy", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.mintAgentApiBearer
      .mockReset()
      .mockResolvedValue({ bearer: "api-user" });
  });

  it("mints the API audience and preserves only protocol headers", async () => {
    vi.stubEnv("AOMI_AGENT_API_URL", "http://api-server:8082/");
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessionId: "session" }), {
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18",
          "payment-receipt": "receipt",
          "payment-response": "paid",
          "set-cookie": "forbidden=1",
          "x-request-id": "upstream-request",
        },
      }),
    );
    const response = await proxyAgentApi(
      new Request("https://portal.example/v1/agent/chat?wait=1", {
        method: "POST",
        headers: {
          authorization: "Bearer attacker",
          "aomi-app-key": "app-secret",
          cookie: "secret=1",
          "content-type": "application/json",
          "idempotency-key": "idem-1",
          "mcp-protocol-version": "2025-06-18",
          "payment-signature": "payment",
          "x-request-id": "request-1",
          "x-session-id": "session-1",
          "x-thread-id": "thread-1",
        },
        body: "{}",
      }),
      principal,
      upstream,
    );

    expect(mocks.mintAgentApiBearer).toHaveBeenCalledWith("canonical-user", {
      scope: "agent:write payments:submit",
      resource: "https://portal.example/v1/agent",
      client_id: "client-1",
      auth_source: "oauth",
      principal_class: "user",
      grant_id: undefined,
      sid: undefined,
    });
    const [url, init] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://api-server:8082/v1/agent/chat?wait=1");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer api-user");
    expect(headers.get("aomi-app-key")).toBe("app-secret");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("idempotency-key")).toBe("idem-1");
    expect(headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(headers.get("payment-signature")).toBe("payment");
    expect(headers.get("x-session-id")).toBe("session-1");
    expect(headers.get("x-thread-id")).toBe("thread-1");
    expect(response.headers.get("payment-response")).toBe("paid");
    expect(response.headers.get("payment-receipt")).toBe("receipt");
    expect(response.headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed without a hosted API-server URL", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => configuredAgentApiUrl()).toThrow("AOMI_AGENT_API_URL");
  });

  it("proxies Pipeline REST and MCP on the same authenticated boundary", async () => {
    vi.stubEnv("AOMI_AGENT_API_URL", "http://api-server:8082");
    const upstream = vi.fn().mockResolvedValue(Response.json({ tools: [] }));
    await proxyAgentApi(
      new Request(
        "https://portal.example/v1/pipeline/tool-calls?app=public-swap&application_id=42&platform=community",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "pipeline-1",
            "payment-signature": "payment-1",
          },
          body: "{}",
        },
      ),
      {
        ...principal,
        scopes: ["pipeline:execute", "payments:submit"],
        resource: "https://portal.example/v1/pipeline",
      },
      upstream,
    );
    const [url, init] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://api-server:8082/v1/pipeline/tool-calls?app=public-swap&application_id=42&platform=community",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe("pipeline-1");
    expect(headers.get("payment-signature")).toBe("payment-1");
  });

  it("proxies the exact Pipeline root", async () => {
    vi.stubEnv("AOMI_AGENT_API_URL", "http://api-server:8082");
    const upstream = vi
      .fn()
      .mockResolvedValue(Response.json({ resources: [] }));
    const response = await proxyAgentApi(
      new Request("https://portal.example/v1/pipeline"),
      {
        ...principal,
        scopes: ["pipeline:catalog"],
        resource: "https://portal.example/v1/pipeline",
      },
      upstream,
    );
    expect(response.status).toBe(200);
    expect(String(upstream.mock.calls[0]?.[0])).toBe(
      "http://api-server:8082/v1/pipeline",
    );
  });

  it.each(["/openapi.json", "/.well-known/api-catalog"])(
    "proxies public API discovery at %s without minting a bearer",
    async (path) => {
      vi.stubEnv("AOMI_AGENT_API_URL", "http://api-server:8082");
      const upstream = vi.fn().mockResolvedValue(Response.json({ ok: true }));
      const response = await proxyAgentApiDiscovery(
        new Request(`https://portal.example${path}`, {
          headers: {
            accept: "application/json",
            "payment-signature": "must-not-forward",
            "x-request-id": "discovery-1",
          },
        }),
        upstream,
      );
      expect(response.status).toBe(200);
      expect(String(upstream.mock.calls[0]?.[0])).toBe(
        `http://api-server:8082${path}`,
      );
      const headers = new Headers(upstream.mock.calls[0]?.[1]?.headers);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("x-request-id")).toBe("discovery-1");
      expect(headers.get("payment-signature")).toBeNull();
      expect(mocks.mintAgentApiBearer).not.toHaveBeenCalled();
    },
  );

  it("rejects paths outside the public Agent and Pipeline namespaces", async () => {
    const upstream = vi.fn();
    const response = await proxyAgentApi(
      new Request("https://portal.example/v1/admin/secrets"),
      principal,
      upstream,
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
