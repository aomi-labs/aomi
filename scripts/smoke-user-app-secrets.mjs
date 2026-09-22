#!/usr/bin/env node
// Local-only integration probe. Credentials are public mock fixtures; account
// cookies/bearers stay in memory and reports contain only assertions/statuses.
import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const portal = process.env.AOMI_LOCAL_PORTAL_URL;
const backend = process.env.AOMI_LOCAL_BACKEND_URL;
const agentApi = process.env.AOMI_LOCAL_API_SERVER_URL;
assert(agentApi && new URL(agentApi).hostname === "127.0.0.1", "Set a loopback AOMI_LOCAL_API_SERVER_URL");
assert(process.env.PORTAL_SERVICE_PRIVATE_KEY, "Load the local Portal signing environment");
const portalKey = createPrivateKey(process.env.PORTAL_SERVICE_PRIVATE_KEY.replaceAll("\\n", "\n"));
assert(portal && backend, "Set explicit local Portal and backend URLs");
assert.equal(
  new URL(backend).hostname,
  "127.0.0.1",
  "Backend must be loopback",
);
const app = "credential-demo";
const values = [
  "demo-token-a",
  "demo-token-b",
  "demo-token-replacement",
  "demo-optional-tag",
  "demo-token-invalid",
];
const evidence = [];
function record(story, status = "PASS") {
  evidence.push({ story, status });
  console.log(`${status} ${story}`);
}
function noSecrets(value) {
  const serialized = JSON.stringify(value);
  for (const secret of values)
    assert(!serialized.includes(secret), "Secret leaked in response");
}
async function request(origin, path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const result = await requestOnce(origin, path, init);
    // Payment accounts completed direct usage on a five-second cadence. Retry
    // only admission conflicts, preserving the exact request/idempotency key.
    if (attempt >= 10 || result.status !== 409 ||
        result.data?.error?.code !== "execution_conflict" ||
        !path.startsWith("/v1/pipeline/")) return result;
    await delay(1000);
  }
}
async function requestOnce(origin, path, { body, headers = {}, ...init } = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: portal, Connection: "close", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  noSecrets(data);
  return { response, status: response.status, data };
}
async function signIn(label) {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const cookies = new Map();
  const call = async (path, init) => {
    const result = await request(portal, path, {
      ...init,
      headers: {
        Cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
      },
    });
    for (const cookie of result.response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const equal = pair.indexOf("=");
      cookies.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    assert.equal(result.status, 200, `${label} ${path}: HTTP ${result.status}`);
    return result.data;
  };
  const { nonce } = await call("/api/auth/siwe/nonce", {
    method: "POST",
    body: {},
  });
  const message = `${new URL(portal).host} wants you to sign in with your Ethereum account:\n${wallet.address}\n\nSign in to Aomi.\n\nURI: ${portal}\nVersion: 1\nChain ID: 11155111\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  await call("/api/auth/siwe/verify", {
    method: "POST",
    body: { message, signature: await wallet.signMessage({ message }) },
  });
  const { bearer } = await call("/v1/account/bearer");
  assert.equal(typeof bearer, "string");
  const claims = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url"));
  record(`${label} authenticated through SIWE and canonical account bearer`);
  return {
    id: claims.sub,
    thread: randomUUID(),
    stateless(path, arguments_ = {}) {
      return request(portal, path, {
        method: "POST",
        headers: {
          Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          "Idempotency-Key": randomUUID(),
        },
        body: arguments_,
      });
    },
    execute(arguments_, headers = {}) {
      // The local probe exercises normal API-server admission and delegation.
      // Its subject comes only from this account's completed SIWE session.
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const jwtHeader = JSON.parse(Buffer.from(bearer.split(".")[0], "base64url"));
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        ...claims,
        aud: "aomi-api-server",
        iat: now,
        exp: now + 300,
        scope: "mcp:pipeline pipeline:execute",
        resource: `${portal}/v1/pipeline/mcp`,
        auth_source: "session",
        principal_class: "user",
        sid: "local-siwe-probe",
      };
      const unsigned = `${encode(jwtHeader)}.${encode(payload)}`;
      const token = `${unsigned}.${sign(null, Buffer.from(unsigned), portalKey).toString("base64url")}`;
      return request(agentApi, "/v1/pipeline/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": randomUUID(), ...headers },
        body: {
          jsonrpc: "2.0", id: randomUUID(), method: "tools/call",
          params: { name: "aomi_call_tool", arguments: arguments_ },
        },
      }).then((result) => {
        // MCP wraps backend authorization failures in a tool result; retain
        // the actual status for the same assertions used by the REST probe.
        if (result.data?.result?.isError) {
          const text = result.data.result.content?.find((item) => item.type === "text")?.text;
          const error = text ? JSON.parse(text) : undefined;
          if (Number.isInteger(error?.status)) return { ...result, status: error.status };
        }
        return result;
      });
    },
    call(path, init = {}) {
      return request(backend, path, {
        ...init,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Thread-Id": this.thread,
          ...init.headers,
        },
      });
    },
  };
}

const a = await signIn("A");
const b = await signIn("B");
assert.notEqual(a.id, b.id);
const catalog = await a.call("/api/account/apps");
assert.equal(catalog.status, 200);
const descriptor = catalog.data.find((entry) => entry.name === app);
assert(
  descriptor,
  "credential-demo must be installed in local backend catalog",
);
const applicationId = descriptor.application_id ?? descriptor.id;
assert(
  Number.isInteger(applicationId),
  "Demo must have canonical application id",
);
const path = `/api/account/apps/${applicationId}/secrets`;
const save = (user, secrets) =>
  user.call(path, { method: "POST", body: { secrets } });
const status = async (user) => {
  const result = await user.call(path);
  assert.equal(result.status, 200);
  return result.data;
};
const invoke = (user, extra = {}) =>
  user.execute({
    app,
    application_id: applicationId,
    platform: descriptor.platform,
    tool_id: "credential_demo_validate",
    arguments: {},
    ...extra.body,
    thread_id: extra.headers?.["X-Thread-Id"] ?? user.thread,
  });
function validatedResult(value) {
  if (typeof value === "string") {
    try {
      return validatedResult(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  if (value.validated === true) return value;
  return Object.values(value).map(validatedResult).find(Boolean);
}
const successful = (result, profile, optional) => {
  assert.equal(result.status, 200, `Invocation HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  const validated = validatedResult(result.data);
  assert(validated, "Mock validation must succeed");
  assert.equal(
    validated.credential_profile,
    profile,
    "Mock must identify the expected harmless credential profile",
  );
  assert.equal(validated.optional_credential_present, optional);
};

assert([401, 403].includes((await request(backend, path)).status));
record("Signed-out credential access rejected");
const empty = await status(a);
assert.equal(empty.ready, false);
assert(
  empty.slots.some(
    (slot) => slot.required && slot.user_own && !slot.configured,
  ),
);
assert(empty.slots.some((slot) => !slot.required && slot.user_own));
record("Required and optional user-owned declarations exposed without values");
const forged = await a.call(path, {
  method: "POST",
  body: { user_id: b.id, secrets: { DEMO_API_TOKEN: values[0] } },
});
assert([400, 422].includes(forged.status));
assert.equal((await status(b)).ready, false);
record("Forged user ownership rejected without changing B");
assert.equal((await save(a, { UNKNOWN_SLOT: values[0] })).status, 400);
assert.equal((await save(a, { DEMO_API_TOKEN: "   " })).status, 400);
record("Undeclared and blank credentials rejected");

const profile = await a.call("/api/account");
assert.equal(profile.status, 200);
const installed =
  profile.data.user?.apps ??
  profile.data.user?.applications ??
  profile.data.apps ??
  [];
const install = (user, apps) =>
  user.call("/api/account/apps", { method: "PUT", body: { apps } });
assert(
  [400, 409, 422].includes((await install(a, [...installed, app])).status),
);
record("Installation blocked before required credential is saved");
assert.equal((await save(a, { DEMO_API_TOKEN: values[0] })).status, 200);
assert.equal((await status(a)).ready, true);
assert.equal((await status(b)).ready, false);
assert.equal((await install(a, [...installed, app])).status, 200);
record("Required-only setup installs; optional credential may be skipped");
successful(await invoke(a), "demo-account-a", false);
record("A credential reaches the real app and local mock");
successful(await a.stateless(`/v1/pipeline/apps/${app}/operations/credential_demo_validate?application_id=${applicationId}`), "demo-account-a", false);
record("Stateless public app operation resolves the authenticated user credential");
successful(
  await invoke(a, { body: { arguments: { user_id: b.id, client_id: b.id } } }),
  "demo-account-a",
  false,
);
record("Model arguments cannot forge credential ownership");
assert.equal((await save(a, { DEMO_API_TOKEN: values[4] })).status, 200);
assert(!validatedResult((await invoke(a)).data));
assert.equal((await save(a, { DEMO_API_TOKEN: values[0] })).status, 200);
record(
  "Invalid provider credential fails execution without exposing its value",
);

assert.equal(
  (await save(b, { DEMO_API_TOKEN: values[1], DEMO_ACCOUNT_TAG: values[3] }))
    .status,
  200,
);
assert.equal((await install(b, [app])).status, 200);
successful(await invoke(b), "demo-account-b", true);
successful(await invoke(a), "demo-account-a", false);
record("A and B execute independently with distinct mock credential profiles");
const foreign = await invoke(b, { headers: { "X-Thread-Id": a.thread } });
assert([401, 403, 404].includes(foreign.status));
record("B cannot execute through A's thread");

assert.equal((await save(a, { DEMO_API_TOKEN: values[2] })).status, 200);
successful(await invoke(a), "demo-account-a-rotated", false);
successful(await invoke(b), "demo-account-b", true);
record("Replacement takes effect in existing thread without affecting B");

if (process.env.AOMI_DEV && process.env.AOMI_WORKSPACE) {
  console.log("Restarting the local backend to verify durable credentials");
  execFileSync(
    process.env.AOMI_DEV,
    ["restart", process.env.AOMI_WORKSPACE, "--service", "backend", "--build"],
    { stdio: "pipe", timeout: 240000 },
  );
  successful(await invoke(a), "demo-account-a-rotated", false);
  successful(await invoke(b), "demo-account-b", true);
  record("Encrypted credentials survive backend restart");
} else
  record(
    "Backend restart verification (set AOMI_DEV and AOMI_WORKSPACE)",
    "SKIPPED",
  );

assert.equal(
  (await a.call(`${path}/DEMO_API_TOKEN`, { method: "DELETE" })).status,
  200,
);
assert.equal((await status(a)).ready, false);
const removed = await invoke(a);
assert(!validatedResult(removed.data));
successful(await invoke(b), "demo-account-b", true);
record(
  "Removal prevents subsequent credential-dependent execution; B still works",
);
record(
  "No credential values in any status or model-visible execution responses",
);
if (process.env.AOMI_EVIDENCE_FILE) {
  await writeFile(
    process.env.AOMI_EVIDENCE_FILE,
    JSON.stringify({ app, application_id: applicationId, evidence }, null, 2),
  );
}
