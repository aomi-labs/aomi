import { describe, expect, it, vi } from "vitest";

vi.mock("./principal", () => ({
  ApiPrincipalError: class ApiPrincipalError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      readonly requiredScopes: readonly string[] = [],
    ) {
      super(code);
    }
  },
}));
vi.mock("./resources", () => ({
  aomiOAuthResourcePolicy: (resource: string) =>
    resource.endsWith("/v1/agent/mcp")
      ? {
          allowedScopes: [
            "mcp:agent",
            "agent:read",
            "agent:write",
            "payments:submit",
            "custody:delegate",
          ],
        }
      : resource.endsWith("/v1/pipeline/mcp")
        ? {
            allowedScopes: [
              "mcp:pipeline",
              "pipeline:catalog",
              "pipeline:execute",
              "payments:submit",
              "custody:delegate",
            ],
          }
        : null,
}));

import { downscopeMcpPrincipal } from "./mcp-principal";

const pipelineResource = "https://portal.example/v1/pipeline/mcp" as const;
const base = {
  canonicalUserId: "user-1",
  resource: pipelineResource,
  authSource: "oauth" as const,
  principalClass: "user" as const,
};

function call(name: string, payment = false) {
  return new Request(pipelineResource, {
    method: "POST",
    headers: payment ? { "payment-signature": "signed" } : undefined,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name },
      id: 1,
    }),
  });
}

describe("MCP resource delegation boundary", () => {
  it.each([
    "aomi_get_agent_context",
    "aomi_list_apps",
    "aomi_list_namespaces",
    "aomi_list_tools",
    "future_tool_owned_by_rust",
  ])("does not classify the Pipeline tool %s", (tool) => {
    expect(
      downscopeMcpPrincipal(
        call(tool),
        {
          ...base,
          scopes: ["mcp:pipeline", "pipeline:catalog", "unrelated:scope"],
        },
        pipelineResource,
        "mcp:pipeline",
      ),
    ).toMatchObject({
      scopes: ["mcp:pipeline", "pipeline:catalog"],
    });
  });

  it("preserves authorized execute and custody scopes for Rust", () => {
    expect(
      downscopeMcpPrincipal(
        call("aomi_call_tool"),
        {
          ...base,
          scopes: ["mcp:pipeline", "pipeline:execute", "custody:delegate"],
        },
        pipelineResource,
        "mcp:pipeline",
      ).scopes,
    ).toEqual(["mcp:pipeline", "pipeline:execute", "custody:delegate"]);
  });

  it("fails closed for a wrong resource, missing transport, or unpaid scope", () => {
    expect(() =>
      downscopeMcpPrincipal(
        call("aomi_list_apps"),
        { ...base, scopes: ["mcp:pipeline"] },
        "https://portal.example/v1/agent/mcp",
        "mcp:agent",
      ),
    ).toThrow("invalid_token");
    expect(() =>
      downscopeMcpPrincipal(
        call("aomi_list_apps"),
        { ...base, scopes: ["pipeline:catalog"] },
        pipelineResource,
        "mcp:pipeline",
      ),
    ).toThrow("insufficient_scope");
    expect(() =>
      downscopeMcpPrincipal(
        call("aomi_call_tool", true),
        { ...base, scopes: ["mcp:pipeline", "pipeline:execute"] },
        pipelineResource,
        "mcp:pipeline",
      ),
    ).toThrow("insufficient_scope");
  });
});
