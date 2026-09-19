import { Aomi, type AomiOAuthTokenProvider } from "@aomi-labs/client";
import { resolveHeadlessOAuthConfig } from "../shared/oauth";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
const accessToken = process.env.AOMI_OAUTH_ACCESS_TOKEN?.trim();
const { resource, scopes } = resolveHeadlessOAuthConfig(baseUrl);
if (!accessToken) {
  throw new Error("Set AOMI_OAUTH_ACCESS_TOKEN");
}

// The host owns token acquisition and persistence. This example deliberately
// keeps the supplied token in process memory and refuses resource/scope reuse.
const oauth: AomiOAuthTokenProvider = async (request) => {
  if (
    request.forceRefresh ||
    request.resource !== resource ||
    request.scopes.some((scope) => !scopes.includes(scope))
  ) {
    return null;
  }
  return {
    accessToken,
    expiresAt: Date.now() + 5 * 60_000,
    resource,
    scopes,
  };
};
const aomi = new Aomi({ baseUrl, guest: false, oauth });
if (resource.endsWith("/v1/agent")) {
  const sessions = await aomi.raw.agent.sessions.list({ limit: 5 });
  console.log(`OAuth can read ${sessions.sessions.length} Agent session(s)`);
} else {
  const catalog = await aomi.raw.pipeline.apps.list();
  console.log(`OAuth can read ${catalog.entries.length} Pipeline app(s)`);
}
