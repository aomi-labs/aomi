import { homedir } from "node:os";
import { join } from "node:path";

import { Aomi, oauth } from "@aomi-labs/client";

import { createJsonFileGrantStore } from "./grant-stores";
import { resolveHeadlessOAuthConfig } from "../shared/oauth";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
const { resource } = resolveHeadlessOAuthConfig(baseUrl);
const target = resource.endsWith("/v1/pipeline") ? "pipeline" : "agent";
const clientId = process.env.AOMI_OAUTH_CLIENT_ID?.trim();
if (!clientId) throw new Error("Set AOMI_OAUTH_CLIENT_ID to a managed client");

// Refresh grants survive process restarts. On the first run, Aomi asks the
// user to approve a device code. Later runs refresh silently until the user
// revokes access or the refresh grant expires.
const storePath =
  process.env.AOMI_OAUTH_STORE_PATH?.trim() ||
  join(homedir(), ".config", "aomi", "oauth-grants.json");

const aomi = new Aomi({
  baseUrl,
  auth: oauth({
    clientId,
    store: createJsonFileGrantStore(storePath),
    onVerification({ verificationUriComplete, verificationUri, userCode }) {
      console.log(
        `Open ${verificationUriComplete ?? verificationUri} and confirm code ${userCode}`,
      );
    },
  }),
});

// A public device client is bound to one exact REST resource. Login is
// optional: API calls acquire and refresh this target's grant lazily too.
await aomi.auth.login({ for: target });
if (target === "agent") {
  const sessions = await aomi.raw.agent.sessions.list({ limit: 5 });
  console.log(`OAuth can read ${sessions.sessions.length} Agent session(s)`);
} else {
  const catalog = await aomi.raw.pipeline.apps.list();
  console.log(`OAuth can read ${catalog.entries.length} Pipeline app(s)`);
}
