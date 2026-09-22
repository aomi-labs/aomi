#!/usr/bin/env node
// Exercise the built TypeScript SDK against a disposable, signed-in local CLI account.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AomiClient } from "../packages/client/dist/index.js";

const stateDir = process.env.AOMI_STATE_DIR;
const baseUrl = process.env.AOMI_LOCAL_PORTAL_URL;
assert(stateDir && baseUrl, "Set explicit local CLI state and Portal URL");
const active = (
  await readFile(join(stateDir, "active-session.txt"), "utf8")
).trim();
assert(/^\d+$/.test(active));
const state = JSON.parse(
  await readFile(join(stateDir, "sessions", `session-${active}.json`), "utf8"),
);
assert.equal(state.baseUrl, baseUrl);
assert(state.auth?.sessionToken, "Sign in through the CLI first");
const fixtures = [
  "demo-token-a",
  "demo-token-replacement",
  "demo-optional-tag",
];
const evidence = [];
const client = new AomiClient({
  baseUrl,
  getAccountBearer: async () => state.auth.sessionToken,
});
const session = randomUUID();
const check = (result) => {
  const text = JSON.stringify(result);
  assert(
    fixtures.every((value) => !text.includes(value)),
    "SDK response exposed a credential",
  );
  return result;
};
const pass = (story) => {
  evidence.push(story);
  console.log(`PASS ${story}`);
};
const app = check(await client.listAccountApps(session)).find(
  (entry) => entry.name === "credential-demo",
);
assert(app?.applicationId);
const id = app.applicationId;
await client.removeAccountApp(session, app.name);
assert(!(await client.getAccount(session)).user.apps.includes(app.name));
pass("SDK removes an installed app");
check(await client.clearAppSecrets(session, id));
assert.equal(
  check(await client.getAppCredentialsStatus(session, id)).ready,
  false,
);
await assert.rejects(client.addAccountApp(session, app.name), /HTTP 422/);
pass("SDK installation rejects missing required credentials");
assert.equal(
  check(
    await client.setAppCredential(session, id, "DEMO_API_TOKEN", fixtures[0]),
  ).ready,
  true,
);
check(await client.addAccountApp(session, app.name));
assert((await client.getAccount(session)).user.apps.includes(app.name));
pass(
  "SDK sets required credential and adds the app without an optional credential",
);
check(
  await client.setAppCredential(session, id, "DEMO_ACCOUNT_TAG", fixtures[2]),
);
check(
  await client.replaceAppCredential(session, id, "DEMO_API_TOKEN", fixtures[1]),
);
const configured = check(await client.getAppCredentialsStatus(session, id));
assert(configured.slots.every((slot) => slot.configured));
pass(
  "SDK sets optional and replaces required credentials; status contains no values",
);
check(await client.removeAppCredential(session, id, "DEMO_API_TOKEN"));
assert.equal(
  check(await client.getAppCredentialsStatus(session, id)).ready,
  false,
);
pass("SDK removes required credential and reports setup required");
check(
  await client.setAppCredential(session, id, "DEMO_API_TOKEN", fixtures[0]),
);
check(await client.removeAppCredential(session, id, "DEMO_ACCOUNT_TAG"));
pass("SDK restores the demo to required-only ready state");
if (process.env.AOMI_EVIDENCE_FILE)
  await writeFile(
    process.env.AOMI_EVIDENCE_FILE,
    JSON.stringify({ application_id: id, evidence }, null, 2),
  );
