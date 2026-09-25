#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

assert(
  process.env.AOMI_STATE_DIR && process.env.AOMI_BACKEND_URL,
  "Set explicit disposable local CLI state and URL",
);
const fixtures = [
  "demo-token-a",
  "demo-token-replacement",
  "demo-optional-tag",
];
const evidence = [];
async function cli(args, input, expectedCode = 0) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const result = spawnSync(
      process.execPath,
      ["packages/client/dist/cli.js", ...args],
      {
        input,
        encoding: "utf8",
        timeout: 120000,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(
      /\u001b\[[0-9;]*m/g,
      "",
    );
    assert(
      fixtures.every((value) => !output.includes(value)),
      "CLI exposed a credential value",
    );
    if (
      result.status !== 0 &&
      /session busy|execution[ _]conflict/.test(output) &&
      attempt < 15
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    assert.equal(
      result.status,
      expectedCode,
      `CLI ${args.slice(0, 4).join(" ")}: ${output}`,
    );
    if (args[0] === "chat")
      await new Promise((resolve) => setTimeout(resolve, 6000));
    return output;
  }
}
const pass = (story, output) => {
  evidence.push({ story, ...(output ? { output } : {}) });
  console.log(`PASS ${story}`);
};
const credential = (action, slot, input) =>
  cli(["app", "credentials", action, "16", slot, "--json"], input);
await cli(["app", "remove", "16", "--json"]);
await credential("remove", "DEMO_API_TOKEN");
await credential("remove", "DEMO_ACCOUNT_TAG");
await cli(["app", "add", "16", "--json"], undefined, 1);
pass("CLI blocks installing an app with a missing required credential");
await credential("set", "DEMO_API_TOKEN", fixtures[0]);
await cli(["app", "add", "16", "--json"]);
const status = JSON.parse(
  await cli(["app", "credentials", "status", "16", "--json"]),
);
assert.equal(status.ready, true);
assert.equal(
  status.slots.find((slot) => slot.name === "DEMO_ACCOUNT_TAG").configured,
  false,
);
pass(
  "CLI sets a required credential through stdin and installs; optional may be skipped",
);
const direct = [
  "chat",
  "--new-session",
  "--mode",
  "direct",
  "--app",
  "credential-demo",
  "--application-id",
  "16",
  "--verbose",
];
let output = await cli([
  ...direct,
  "Run credential_demo_validate once and report the exact safe credential_profile and optional_credential_present fields.",
]);
assert(output.includes("demo-account-a"));
pass(
  "CLI Direct mode selects the app and invokes it with the saved credential",
  output,
);
await credential("replace", "DEMO_API_TOKEN", fixtures[1]);
await credential("set", "DEMO_ACCOUNT_TAG", fixtures[2]);
output = await cli([
  ...direct,
  "Run credential_demo_validate again now and report the exact safe credential_profile and optional_credential_present fields.",
]);
assert(output.includes("demo-account-a-rotated"));
pass(
  "CLI replacement reaches actual execution and optional credential is accepted",
  output,
);
await credential("remove", "DEMO_API_TOKEN");
assert.equal(
  JSON.parse(await cli(["app", "credentials", "status", "16", "--json"])).ready,
  false,
);
pass("CLI removes a saved credential and reports setup required");
await credential("set", "DEMO_API_TOKEN", fixtures[0]);
await credential("remove", "DEMO_ACCOUNT_TAG");
output = await cli([
  "chat",
  "--new-session",
  "--mode",
  "auto",
  "--verbose",
  "Use the installed credential-demo app (application 16, community) to run credential_demo_validate once. Delegate to that app and report the actual safe validation result.",
]);
assert(output.includes("demo-account-a"));
pass(
  "CLI Auto mode invokes the installed app with the same account credential",
  output,
);
const apps = JSON.parse(await cli(["app", "list", "--json"]));
assert(apps.some((app) => app.applicationId === 16 && app.installed));
for (const name of await readdir(
  join(process.env.AOMI_STATE_DIR, "sessions"),
)) {
  const contents = await readFile(
    join(process.env.AOMI_STATE_DIR, "sessions", name),
    "utf8",
  );
  assert(
    fixtures.every((value) => !contents.includes(value)),
    "CLI persisted an app credential",
  );
}
pass(
  "CLI list reflects installation and its saved state contains no app credential values",
);
if (process.env.AOMI_EVIDENCE_FILE)
  await writeFile(
    process.env.AOMI_EVIDENCE_FILE,
    JSON.stringify({ evidence }, null, 2),
  );
