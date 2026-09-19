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
  PIPELINE_SCOPES: [
    "pipeline:catalog",
    "pipeline:execute",
    "payments:submit",
    "custody:delegate",
    "mcp:pipeline",
  ],
  aomiOAuthResources: () => ({
    pipelineRest: "https://portal.example/v1/pipeline",
  }),
}));

import { GET, OPTIONS, POST } from "./route";

describe("canonical Pipeline BFF route", () => {
  beforeEach(() => {
    mocks.resolveApiPrincipal.mockReset();
    mocks.proxyAgentApi.mockReset();
  });

  it("rejects an anonymous request before proxying", async () => {
    mocks.resolveApiPrincipal.mockRejectedValue(new Error("invalid_token"));
    const response = await GET(
      new Request("https://portal.example/v1/pipeline/tools"),
    );
    expect(response.status).toBe(401);
    expect(mocks.proxyAgentApi).not.toHaveBeenCalled();
  });

  it("answers cross-origin preflight and makes an auth error readable", async () => {
    const origin = "https://consumer.example";
    const preflight = OPTIONS(
      new Request("https://portal.example/v1/pipeline/tools", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(mocks.resolveApiPrincipal).not.toHaveBeenCalled();

    mocks.resolveApiPrincipal.mockRejectedValue(new Error("invalid_token"));
    const response = await POST(
      new Request("https://portal.example/v1/pipeline/tools", {
        method: "POST",
        headers: { origin },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it.each([GET, POST])("delegates every supported method", async (handler) => {
    const principal = {
      canonicalUserId: "canonical-user",
      scopes: ["pipeline:catalog", "pipeline:execute", "custody:delegate"],
      resource: "https://portal.example/v1/pipeline",
      authSource: "session",
      principalClass: "user",
    } as const;
    mocks.resolveApiPrincipal.mockResolvedValue(principal);
    mocks.proxyAgentApi.mockResolvedValue(new Response("ok"));
    const request = new Request("https://portal.example/v1/pipeline/tools", {
      method: handler === GET ? "GET" : "POST",
    });
    expect((await handler(request)).status).toBe(200);
    expect(mocks.proxyAgentApi).toHaveBeenCalledWith(request, {
      ...principal,
      scopes:
        handler === GET
          ? ["pipeline:catalog"]
          : ["pipeline:execute", "custody:delegate"],
    });
  });
});
