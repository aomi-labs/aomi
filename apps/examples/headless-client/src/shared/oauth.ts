import type { AomiOAuthResource } from "@aomi-labs/client";

const RESOURCE_SCOPES = {
  agent: ["agent:read", "agent:write", "agent:actions:resolve"],
  pipeline: ["pipeline:catalog", "pipeline:execute"],
} as const;

export type HeadlessOAuthConfig = {
  resource: AomiOAuthResource;
  scopes: string[];
};

/** Resolve only the exact REST resources exposed by the configured Portal. */
export function resolveHeadlessOAuthConfig(
  portalBaseUrl: string,
  rawResource = process.env.AOMI_OAUTH_RESOURCE,
  rawScopes = process.env.AOMI_OAUTH_SCOPES,
): HeadlessOAuthConfig {
  const portal = new URL(portalBaseUrl);
  if (portal.protocol !== "http:" && portal.protocol !== "https:") {
    throw new Error("AOMI_BASE_URL must use http or https");
  }
  const resourceUrl = new URL(
    rawResource?.trim() || `${portal.origin}/v1/agent`,
  );
  const resourcePath = resourceUrl.pathname;
  const kind =
    resourcePath === "/v1/agent"
      ? "agent"
      : resourcePath === "/v1/pipeline"
        ? "pipeline"
        : null;
  if (
    resourceUrl.origin !== portal.origin ||
    !kind ||
    resourceUrl.username ||
    resourceUrl.password ||
    resourceUrl.search ||
    resourceUrl.hash
  ) {
    throw new Error(
      `AOMI_OAUTH_RESOURCE must be exactly ${portal.origin}/v1/agent or ${portal.origin}/v1/pipeline`,
    );
  }

  const scopes = (rawScopes?.trim() || RESOURCE_SCOPES[kind].join(" "))
    .split(/\s+/)
    .filter(Boolean);
  const allowed = new Set([...RESOURCE_SCOPES[kind], "offline_access"]);
  if (
    new Set(scopes).size !== scopes.length ||
    scopes.some((scope) => !allowed.has(scope))
  ) {
    throw new Error(
      `AOMI_OAUTH_SCOPES contains a scope that is not allowed for ${resourceUrl.toString()}`,
    );
  }

  return { resource: resourceUrl.toString() as AomiOAuthResource, scopes };
}
