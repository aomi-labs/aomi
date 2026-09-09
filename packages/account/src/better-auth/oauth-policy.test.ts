import { describe, expect, it } from "vitest";
import {
  AOMI_SCOPES,
  MCP_CLIENT_REGISTRATION_SCOPES,
  OFFLINE_ACCESS_SCOPE,
  narrowScopesForAomiResource,
  aomiOAuthResourcePolicies,
  aomiOAuthResources,
  guestScopesForAomiResource,
  validateAomiResourceScopes,
} from "./oauth-policy";

const env = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test.invalid/aomi",
  BETTER_AUTH_URL: "https://portal.example",
};

describe("Aomi OAuth resource policy", () => {
  it("uses the Better Auth base path as the one canonical issuer", () => {
    const resources = aomiOAuthResources(env);
    expect(resources.authorizationServerIssuer).toBe(
      "https://portal.example/api/auth",
    );
    expect(resources.agentMcp).toBe("https://portal.example/v1/agent/mcp");
    expect(resources.pipelineMcp).toBe(
      "https://portal.example/v1/pipeline/mcp",
    );
  });

  it("rejects cross-resource, OIDC-mixed, duplicate, and unknown scopes", () => {
    const resources = aomiOAuthResources(env);
    expect(
      validateAomiResourceScopes(resources.agentRest, ["agent:read"], env),
    ).toMatchObject({ ok: true });
    for (const scopes of [
      ["pipeline:catalog"],
      ["agent:read", "openid"],
      ["agent:read", "agent:read"],
      ["unknown:scope"],
    ]) {
      expect(
        validateAomiResourceScopes(resources.agentRest, scopes, env),
      ).toMatchObject({ ok: false });
    }
  });

  it("allows self-custodial guest work without privileged scopes", () => {
    const resources = aomiOAuthResources(env);
    expect(
      guestScopesForAomiResource(
        resources.agentRest,
        ["agent:read", "agent:actions:resolve", "custody:delegate"],
        env,
      ),
    ).toEqual(["agent:read", "agent:actions:resolve"]);
    expect(
      guestScopesForAomiResource(
        resources.pipelineRest,
        ["pipeline:catalog", "pipeline:execute", "payments:submit"],
        env,
      ),
    ).toEqual(["pipeline:catalog", "pipeline:execute"]);
    expect(
      guestScopesForAomiResource(
        resources.pipelineMcp,
        ["mcp:pipeline", "pipeline:execute", "custody:delegate"],
        env,
      ),
    ).toEqual(["mcp:pipeline", "pipeline:execute"]);
  });

  it("centralizes the MCP DPoP rollout switch", () => {
    expect(
      aomiOAuthResourcePolicies({
        ...env,
        AOMI_MCP_DPOP_REQUIRED: "true",
      })
        .filter((policy) => policy.kind.endsWith("Mcp"))
        .every((policy) => policy.dpopBoundAccessTokensRequired),
    ).toBe(true);
  });

  // Regression: MCP login was broken by registering DCR clients with the union
  // of both resources' scopes plus the OIDC scopes. Better Auth registers a
  // client with the allowed set rather than the scope it requested, the client
  // then asks for its whole registered set at authorize, and that request is
  // validated against a single resource — so a registration set that is not
  // valid for one resource on its own cannot complete login.
  it("registers MCP clients with a scope set one resource can satisfy", () => {
    const resources = aomiOAuthResources(env);
    const result = validateAomiResourceScopes(
      resources.agentMcp,
      [...MCP_CLIENT_REGISTRATION_SCOPES],
      env,
    );
    expect(result.ok).toBe(true);
  });

  // Both `codex mcp add aomi-agent` and `codex mcp add aomi-pipeline` must be
  // able to log in. A client builds its scope request from the authorization
  // server's `scopes_supported`, which spans every resource this server hosts,
  // so what makes that possible is narrowing the request to the resource it
  // names — not anything decided at registration.
  it("narrows one over-broad request into a valid grant for either resource", () => {
    const resources = aomiOAuthResources(env);
    // The full advertised set, which is what a client actually asks for.
    const requested = [...AOMI_SCOPES];
    for (const resource of [resources.agentMcp, resources.pipelineMcp]) {
      const narrowed = narrowScopesForAomiResource(resource, requested, env);
      expect(narrowed.length).toBeGreaterThan(0);
      expect(validateAomiResourceScopes(resource, narrowed, env).ok).toBe(true);
    }
  });

  // Clients do request the OIDC scopes — Codex sends `openid` — and the
  // authorization server fails a registration outright on any scope it does
  // not permit, so those must stay requestable. They must equally never reach
  // a resource grant, which validateAomiResourceScopes refuses outright.
  it("keeps identity scopes requestable but out of every resource grant", () => {
    const resources = aomiOAuthResources(env);
    for (const identity of ["openid", "profile", "email"]) {
      expect([...AOMI_SCOPES]).toContain(identity);
      for (const resource of [resources.agentMcp, resources.pipelineMcp]) {
        expect(
          narrowScopesForAomiResource(resource, [...AOMI_SCOPES], env),
        ).not.toContain(identity);
      }
    }
  });

  it("narrows to nothing when no requested scope suits the resource", () => {
    const resources = aomiOAuthResources(env);
    expect(
      narrowScopesForAomiResource(
        resources.agentMcp,
        ["pipeline:execute"],
        env,
      ),
    ).toEqual([]);
    expect(narrowScopesForAomiResource(resources.agentMcp, [], env)).toEqual(
      [],
    );
  });

  // Regression: the protected-resource metadata and the WWW-Authenticate
  // challenge both advertise a resource's scope set, and a client asks for
  // exactly what it is shown. Advertising only the API capabilities meant no
  // client ever requested `offline_access`, no grant carried a refresh token,
  // and every MCP session died at the five-minute access-token expiry with
  // nothing to refresh. What a grant may carry has to be one derived set.
  it("keeps offline_access in every resource's grantable scopes", () => {
    for (const policy of aomiOAuthResourcePolicies(env)) {
      expect(policy.grantableScopes).toContain(OFFLINE_ACCESS_SCOPE);
      expect(policy.grantableScopes).toEqual([
        ...policy.allowedScopes,
        OFFLINE_ACCESS_SCOPE,
      ]);
      // The advertised set must survive its own narrowing and validation, or
      // a client that asks for exactly what it was shown is refused.
      const narrowed = narrowScopesForAomiResource(
        policy.identifier,
        [...policy.grantableScopes],
        env,
      );
      expect(narrowed).toEqual([...policy.grantableScopes]);
      expect(
        validateAomiResourceScopes(policy.identifier, narrowed, env).ok,
      ).toBe(true);
    }
  });

  // offline_access buys a refresh token; it is never an API capability, so it
  // must stay out of the ceiling that bounds what a principal may do.
  it("keeps offline_access out of the capability ceiling", () => {
    for (const policy of aomiOAuthResourcePolicies(env)) {
      expect(policy.allowedScopes).not.toContain(OFFLINE_ACCESS_SCOPE);
    }
  });

  it("refuses the union of every scope against one MCP resource", () => {
    const resources = aomiOAuthResources(env);
    const result = validateAomiResourceScopes(
      resources.agentMcp,
      [...AOMI_SCOPES],
      env,
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_scope" });
  });
});
