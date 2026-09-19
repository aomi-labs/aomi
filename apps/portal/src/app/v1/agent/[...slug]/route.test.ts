import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveApiPrincipal: vi.fn(),
  proxyAgentApi: vi.fn(),
}));

vi.mock("@portal/server/oauth/principal", () => ({
  resolveApiPrincipal: mocks.resolveApiPrincipal,
  apiAuthError: (error: { message: string }) =>
    Response.json({ error: error.message }, { status: 401 }),
}));
vi.mock("@portal/server/agent-api-proxy", () => ({
  proxyAgentApi: mocks.proxyAgentApi,
}));
vi.mock("@portal/server/oauth/resources", () => ({
  AGENT_SCOPES: [
    "agent:read",
    "agent:write",
    "agent:actions:resolve",
    "payments:submit",
    "custody:delegate",
    "mcp:agent",
  ],
  aomiOAuthResources: () => ({
    agentRest: "https://portal.example/v1/agent",
  }),
}));

import { DELETE, GET, OPTIONS, PATCH, POST } from "./route";

describe("canonical Agent BFF route", () => {
  beforeEach(() => {
    mocks.resolveApiPrincipal.mockReset();
    mocks.proxyAgentApi.mockReset();
  });

  it("rejects an anonymous request before proxying", async () => {
    mocks.resolveApiPrincipal.mockRejectedValue(new Error("invalid_token"));
    const response = await GET(
      new Request("https://portal.example/v1/agent/sessions"),
    );
    expect(response.status).toBe(401);
    expect(mocks.proxyAgentApi).not.toHaveBeenCalled();
  });

  it("answers a cross-origin preflight before auth and exposes auth errors", async () => {
    const origin = "https://consumer.example";
    const preflight = OPTIONS(
      new Request("https://portal.example/v1/agent/chat", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(mocks.resolveApiPrincipal).not.toHaveBeenCalled();

    mocks.resolveApiPrincipal.mockRejectedValue(new Error("invalid_token"));
    const rejected = await POST(
      new Request("https://portal.example/v1/agent/chat", {
        method: "POST",
        headers: { origin },
      }),
    );
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("preserves a streamed proxy response and adds origin CORS", async () => {
    mocks.resolveApiPrincipal.mockResolvedValue({ scopes: [] });
    mocks.proxyAgentApi.mockResolvedValue(
      new Response("data: done\\n\\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const response = await POST(
      new Request("https://portal.example/v1/agent/chat", {
        method: "POST",
        headers: { origin: "https://consumer.example" },
      }),
    );
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://consumer.example",
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("data: done\\n\\n");
  });

  it.each([GET, POST, PATCH, DELETE])(
    "delegates every allowed method",
    async (handler) => {
      const principal = {
        canonicalUserId: "canonical-user",
        scopes: [
          "agent:read",
          "agent:write",
          "agent:actions:resolve",
          "custody:delegate",
        ],
        resource: "https://portal.example/v1/agent",
        authSource: "session",
        principalClass: "user",
      } as const;
      mocks.resolveApiPrincipal.mockResolvedValue(principal);
      mocks.proxyAgentApi.mockResolvedValue(new Response("ok"));
      const request = new Request("https://portal.example/v1/agent/sessions", {
        method:
          handler === GET
            ? "GET"
            : handler === POST
              ? "POST"
              : handler === PATCH
                ? "PATCH"
                : "DELETE",
      });
      expect((await handler(request)).status).toBe(200);
      expect(mocks.proxyAgentApi).toHaveBeenCalledWith(request, {
        ...principal,
        scopes:
          handler === GET
            ? ["agent:read"]
            : ["agent:write", "custody:delegate"],
      });
    },
  );
});
