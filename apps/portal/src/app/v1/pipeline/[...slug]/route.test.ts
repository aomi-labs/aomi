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

import { GET, POST } from "./route";

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
