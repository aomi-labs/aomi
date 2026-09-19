import { homedir } from "node:os";
import { join } from "node:path";

import { Aomi, oauth } from "@aomi-labs/client";

import { createJsonFileGrantStore } from "./grant-stores";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
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

// Login is optional: API calls also acquire and refresh the exact grant they
// need. It is useful here to finish all user interaction during startup.
await aomi.auth.login({ for: ["agent", "pipeline"] });

const [sessions, catalog] = await Promise.all([
  aomi.raw.agent.sessions.list({ limit: 5 }),
  aomi.raw.pipeline.apps.list(),
]);

console.log(`OAuth can read ${sessions.sessions.length} Agent session(s)`);
console.log(`OAuth can read ${catalog.entries.length} Pipeline app(s)`);
