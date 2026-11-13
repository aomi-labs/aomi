import { describe, expect, it } from "vitest";
import { resolveHeadlessOAuthConfig } from "./oauth";

describe("headless OAuth configuration", () => {
  it("defaults to the exact Agent resource and scopes", () => {
    expect(resolveHeadlessOAuthConfig("https://aomi.chat")).toEqual({
      resource: "https://aomi.chat/v1/agent",
      scopes: ["agent:read", "agent:write", "agent:actions:resolve"],
    });
  });

  it("supports the exact Pipeline resource with its own scopes", () => {
    expect(
      resolveHeadlessOAuthConfig(
        "https://staging.aomi.chat",
        "https://staging.aomi.chat/v1/pipeline",
        undefined,
      ),
    ).toEqual({
      resource: "https://staging.aomi.chat/v1/pipeline",
      scopes: ["pipeline:catalog", "pipeline:execute"],
    });
  });

  it.each([
    "https://other.example/v1/agent",
    "https://aomi.chat/v1/agent/",
    "https://aomi.chat/v1/agent/mcp",
    "https://aomi.chat/v1/agent?extra=1",
    "https://user:pass@aomi.chat/v1/agent",
  ])("rejects non-canonical resource %s", (resource) => {
    expect(() =>
      resolveHeadlessOAuthConfig("https://aomi.chat", resource),
    ).toThrow("AOMI_OAUTH_RESOURCE must be exactly");
  });

  it("rejects scopes belonging to another resource", () => {
    expect(() =>
      resolveHeadlessOAuthConfig(
        "https://aomi.chat",
        "https://aomi.chat/v1/agent",
        "agent:read pipeline:execute",
      ),
    ).toThrow("AOMI_OAUTH_SCOPES contains");
  });
});
