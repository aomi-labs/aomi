import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// MCP acceptance smoke. It never prints credentials. Optional target and
// local-isolation knobs:
//   AOMI_MCP_E2E_ORIGIN — Portal origin (default: http://localhost:3000).
//   AOMI_MCP_E2E_LOCAL_DB_URL — mirror the generated canonical user into the
//     explicitly local `aomi_local` backend database.
//   AOMI_MCP_E2E_PRIVATE_KEY — use an existing EVM test wallet for SIWE instead
//     of generating a throwaway key. The value is never printed.
//   AOMI_MCP_E2E_CHAIN_ID — SIWE chain id for that wallet (default: 31337).
//   AOMI_MCP_E2E_ANVIL_URL + AOMI_MCP_E2E_WALLET_PROMPT — fund the generated
//     wallet on local Anvil and require a real `awaiting_user` wallet handoff.
//   AOMI_MCP_E2E_CHECK_SESSION — require an existing session to reach complete
//     with no pending request after the regular smoke.
//   AOMI_MCP_E2E_COOKIE_FILE — write a mode-0600 Cookie header for a separate
//     agent-browser pass; delete it immediately after the browser run.
const origin =
  process.env.AOMI_MCP_E2E_ORIGIN?.trim() || "http://localhost:3000";
const redirectUri = "http://127.0.0.1:49152/callback";
const chainId = Number(process.env.AOMI_MCP_E2E_CHAIN_ID?.trim() || "31337");
const localBackendDb = process.env.AOMI_MCP_E2E_LOCAL_DB_URL?.trim();
const browserCookieFile = process.env.AOMI_MCP_E2E_COOKIE_FILE?.trim();
const localAnvilUrl = process.env.AOMI_MCP_E2E_ANVIL_URL?.trim();
const walletPrompt = process.env.AOMI_MCP_E2E_WALLET_PROMPT?.trim();
const checkSession = process.env.AOMI_MCP_E2E_CHECK_SESSION?.trim();
const configuredPrivateKey = process.env.AOMI_MCP_E2E_PRIVATE_KEY?.trim();

const originUrl = new URL(origin);
assert(
  originUrl.protocol === "https:" ||
    ["127.0.0.1", "localhost"].includes(originUrl.hostname),
  "AOMI_MCP_E2E_ORIGIN must use HTTPS unless it targets localhost",
);

assert(
  Number.isSafeInteger(chainId) && chainId > 0,
  "AOMI_MCP_E2E_CHAIN_ID must be a positive integer",
);

class CookieJar {
  cookies = new Map();

  absorb(response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  header() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  async fetch(path, init = {}) {
    const headers = new Headers(init.headers);
    if (init.method && init.method !== "GET" && !headers.has("origin")) {
      headers.set("origin", origin);
    }
    if (this.cookies.size > 0) {
      headers.set("cookie", this.header());
    }
    const response = await fetch(new URL(path, origin), {
      ...init,
      headers,
      redirect: "manual",
    });
    this.absorb(response);
    return response;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response, label) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label}: HTTP ${response.status}, non-JSON response`);
  }
  if (!response.ok) {
    throw new Error(
      `${label}: HTTP ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function buildSiweMessage({ address, nonce, domain, uri }) {
  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to Aomi.

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;
}

async function signIn(jar) {
  const privateKey = configuredPrivateKey
    ? configuredPrivateKey.startsWith("0x")
      ? configuredPrivateKey
      : `0x${configuredPrivateKey}`
    : generatePrivateKey();
  assert(
    /^0x[0-9a-fA-F]{64}$/.test(privateKey),
    "AOMI_MCP_E2E_PRIVATE_KEY must be a 32-byte hexadecimal EVM private key",
  );
  const account = privateKeyToAccount(privateKey);
  const nonce = await json(
    await jar.fetch("/api/auth/siwe/nonce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress: account.address, chainId }),
    }),
    "SIWE nonce",
  );
  const message = buildSiweMessage({
    address: account.address,
    nonce: nonce.nonce,
    domain: nonce.domain ?? new URL(origin).host,
    uri: nonce.uri ?? origin,
  });
  const signature = await account.signMessage({ message });
  const verified = await json(
    await jar.fetch("/api/auth/siwe/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        signature,
        walletAddress: account.address,
        chainId,
      }),
    }),
    "SIWE verify",
  );
  assert(
    verified.success === true || verified.user_id || verified.user?.id,
    "SIWE response did not confirm a user",
  );
  const graph = await json(
    await jar.fetch("/v1/account"),
    "canonical account graph",
  );
  const canonicalUserId = graph?.user?.id ?? graph?.user?.user_id;
  assert(
    typeof canonicalUserId === "string",
    "account graph omitted canonical user id",
  );
  if (localBackendDb) await mirrorAccountIntoLocalBackend(canonicalUserId);
  console.log("ok SIWE wallet session established");
  return { address: account.address };
}

async function mirrorAccountIntoLocalBackend(canonicalUserId) {
  const database = new URL(localBackendDb);
  assert(
    ["127.0.0.1", "localhost"].includes(database.hostname) &&
      database.pathname === "/aomi_local",
    "AOMI_MCP_E2E_LOCAL_DB_URL must target the local aomi_local database",
  );
  const pg = await import("../packages/account/node_modules/pg/lib/index.js");
  const { Client } = pg.default ?? pg;
  const client = new Client({ connectionString: localBackendDb });
  await client.connect();
  try {
    await client.query(
      `insert into users (id)
       values ($1)
       on conflict (id) do nothing`,
      [canonicalUserId],
    );
  } finally {
    await client.end();
  }
  console.log(
    "ok canonical account mirrored into isolated local backend database",
  );
}

async function oauth(jar) {
  const registered = await json(
    await jar.fetch("/api/auth/mcp/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: `Aomi MCP E2E ${randomUUID()}`,
        scope: "openid profile email offline_access",
      }),
    }),
    "OAuth dynamic registration",
  );
  assert(
    typeof registered.client_id === "string",
    "registration omitted client_id",
  );
  console.log("ok OAuth dynamic client registration");

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const authorize = new URL("/api/auth/mcp/authorize", origin);
  authorize.search = new URLSearchParams({
    client_id: registered.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  const authorizeResponse = await jar.fetch(
    authorize.pathname + authorize.search,
  );
  assert(
    authorizeResponse.status === 302,
    `authorize returned HTTP ${authorizeResponse.status}`,
  );
  const consentUrl = new URL(authorizeResponse.headers.get("location"), origin);
  assert(
    consentUrl.pathname === "/mcp/connect" &&
      consentUrl.searchParams.has("consent_code"),
    "authorize did not redirect to MCP consent",
  );
  console.log("ok OAuth authorize redirected to explicit consent");

  const consent = await json(
    await jar.fetch("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accept: true,
        consent_code: consentUrl.searchParams.get("consent_code"),
      }),
    }),
    "OAuth consent",
  );
  const callback = new URL(consent.redirectURI);
  assert(
    callback.searchParams.get("state") === state,
    "OAuth state did not round-trip",
  );
  const code = callback.searchParams.get("code");
  assert(code, "consent response omitted authorization code");
  console.log("ok OAuth consent and state round-trip");

  const token = await json(
    await jar.fetch("/api/auth/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: registered.client_id,
        code_verifier: verifier,
      }),
    }),
    "OAuth token exchange",
  );
  assert(
    typeof token.access_token === "string",
    "token exchange omitted access token",
  );
  assert(
    typeof token.refresh_token === "string",
    "token exchange omitted refresh token",
  );
  console.log("ok OAuth PKCE token exchange");

  const refreshed = await json(
    await jar.fetch("/api/auth/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: registered.client_id,
      }),
    }),
    "OAuth refresh",
  );
  assert(
    typeof refreshed.access_token === "string",
    "refresh omitted access token",
  );
  console.log("ok OAuth refresh-token rotation");
  return refreshed.access_token;
}

let rpcId = 0;
async function rpc(accessToken, path, method, params) {
  rpcId += 1;
  const body = await json(
    await fetch(new URL(path, origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
    }),
    `${path} ${method}`,
  );
  if (body.error)
    throw new Error(`${path} ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function toolJson(result) {
  const item = result?.content?.find((entry) => entry.type === "text");
  assert(typeof item?.text === "string", "tool response omitted text content");
  const parsed = JSON.parse(item.text);
  if (result.isError) throw new Error(`tool returned error: ${item.text}`);
  return parsed;
}

async function testMcp(accessToken, walletAddress) {
  const initialized = await rpc(accessToken, "/api/mcp", "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "aomi-local-e2e", version: "1" },
  });
  assert(initialized.protocolVersion === "2025-06-18", "protocol mismatch");
  assert(
    initialized.instructions.includes("aomi_check"),
    "chat instructions missing",
  );
  console.log("ok MCP initialize and chat supervision instructions");

  const chatTools = await rpc(accessToken, "/api/mcp", "tools/list", {});
  assert(
    chatTools.tools.length === 4,
    `expected 4 chat tools, got ${chatTools.tools.length}`,
  );
  assert(
    chatTools.tools.map((tool) => tool.name).join(",") ===
      "aomi_chat,aomi_check,aomi_interrupt,aomi_list_sessions",
    "chat tool names did not match the plan",
  );
  const directTools = await rpc(
    accessToken,
    "/api/mcp/direct",
    "tools/list",
    {},
  );
  assert(
    directTools.tools.length === 10,
    `expected 10 direct tools, got ${directTools.tools.length}`,
  );
  console.log("ok primary 4-tool surface and preserved 10-tool direct surface");

  const started = toolJson(
    await rpc(accessToken, "/api/mcp", "tools/call", {
      name: "aomi_chat",
      arguments: {
        message: "Reply with exactly: MCP chat parity works",
        application: "default",
        chain_context: { evm: { address: walletAddress, chainId } },
      },
    }),
  );
  assert(typeof started.session === "string", "aomi_chat omitted session id");
  assert(started.cursor, "aomi_chat omitted cursor");
  console.log(`ok aomi_chat created account session ${started.session}`);

  let current = started;
  const deliveredMessages = [...(started.messages ?? [])];
  for (
    let attempt = 0;
    attempt < 45 && current.status === "processing";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = toolJson(
      await rpc(accessToken, "/api/mcp", "tools/call", {
        name: "aomi_check",
        arguments: { session: started.session, cursor: current.cursor },
      }),
    );
    deliveredMessages.push(...current.messages);
    console.log(
      `ok aomi_check ${attempt + 1}: status=${current.status} messages=${current.messages.length} activity=${current.activity.length}`,
    );
  }
  assert(
    current.status !== "processing",
    "agent turn did not reach a terminal state",
  );
  assert(
    current.status === "complete",
    `unexpected terminal state ${current.status}`,
  );
  assert(
    deliveredMessages.some(
      (message) =>
        ["agent", "assistant"].includes(message?.sender) &&
        typeof message?.content === "string" &&
        message.content.includes("MCP chat parity works"),
    ),
    "completed turn did not deliver the assistant reply through cursor deltas",
  );
  console.log("ok asynchronous chat reached complete through cursor deltas");

  const sessions = toolJson(
    await rpc(accessToken, "/api/mcp", "tools/call", {
      name: "aomi_list_sessions",
      arguments: { limit: 10 },
    }),
  );
  assert(
    sessions.sessions.some((session) => session.id === started.session),
    "new MCP session missing from account thread list",
  );
  console.log("ok aomi_list_sessions includes the new account-owned session");

  const resumed = toolJson(
    await rpc(accessToken, "/api/mcp", "tools/call", {
      name: "aomi_chat",
      arguments: {
        message: "Reply with exactly: resumed",
        session: started.session,
        application: "default",
        chain_context: { evm: { address: walletAddress, chainId } },
      },
    }),
  );
  assert(resumed.session === started.session, "resume changed session id");
  const interrupted = toolJson(
    await rpc(accessToken, "/api/mcp", "tools/call", {
      name: "aomi_interrupt",
      arguments: { session: started.session },
    }),
  );
  assert(
    interrupted.interrupted === true,
    "interrupt result missing confirmation",
  );
  console.log("ok existing-session resume and aomi_interrupt");
  if (walletPrompt) await testPendingWalletRequest(accessToken, walletAddress);
  if (checkSession) await checkCompletedSession(accessToken, checkSession);
  console.log(`MCP_E2E_SESSION=${started.session}`);
}

async function checkCompletedSession(accessToken, sessionId) {
  let state;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    state = toolJson(
      await rpc(accessToken, "/api/mcp", "tools/call", {
        name: "aomi_check",
        arguments: {
          session: sessionId,
          ...(state?.cursor ? { cursor: state.cursor } : {}),
        },
      }),
    );
    console.log(
      `ok completion aomi_check ${attempt + 1}: status=${state.status} pending=${state.actions.length}`,
    );
    if (state.status !== "processing") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(state?.status === "complete", `session ended as ${state?.status}`);
  assert(
    state.actions.length === 0,
    "completed session retained a pending request",
  );
  console.log(`MCP_E2E_COMPLETED_SESSION=${sessionId}`);
}

async function fundLocalWallet(address) {
  const endpoint = new URL(localAnvilUrl);
  assert(
    ["127.0.0.1", "localhost"].includes(endpoint.hostname),
    "AOMI_MCP_E2E_ANVIL_URL must target a local Anvil",
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setBalance",
      params: [address, "0x56BC75E2D63100000"],
    }),
  });
  const body = await json(response, "local wallet funding");
  assert(!body.error, "Anvil did not fund the E2E wallet");
  console.log("ok local E2E wallet funded");
}

async function testPendingWalletRequest(accessToken, walletAddress) {
  let state = toolJson(
    await rpc(accessToken, "/api/mcp", "tools/call", {
      name: "aomi_chat",
      arguments: {
        message: walletPrompt,
        application: "default",
        chain_context: { evm: { address: walletAddress, chainId } },
      },
    }),
  );
  for (
    let attempt = 0;
    attempt < 60 && state.status === "processing";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = toolJson(
      await rpc(accessToken, "/api/mcp", "tools/call", {
        name: "aomi_check",
        arguments: { session: state.session, cursor: state.cursor },
      }),
    );
    console.log(
      `ok wallet aomi_check ${attempt + 1}: status=${state.status} pending=${state.actions.length}`,
    );
  }
  assert(
    state.status === "awaiting_user",
    `wallet turn ended as ${state.status}`,
  );
  assert(state.actions.length > 0, "wallet turn omitted the pending request");
  const exposed = JSON.stringify(state.actions);
  assert(!exposed.includes("calldata"), "pending request exposed calldata");
  assert(!exposed.includes("typedData"), "pending request exposed typed data");
  assert(state.handoff?.portal, "pending request omitted portal handoff");
  console.log(
    "ok real staged transaction surfaced as a redacted wallet handoff",
  );
  console.log(`MCP_E2E_WALLET_SESSION=${state.session}`);
  console.log(
    `MCP_E2E_PENDING_REQUESTS=${state.actions
      .map((request) => request.id)
      .filter(Boolean)
      .join(",")}`,
  );
}

const jar = new CookieJar();
const signedIn = await signIn(jar);
if (localAnvilUrl) await fundLocalWallet(signedIn.address);
const accessToken = await oauth(jar);
if (browserCookieFile) {
  await writeFile(browserCookieFile, `${jar.header()}\n`, { mode: 0o600 });
  console.log("ok browser cookie handoff written to protected temporary file");
}
await testMcp(accessToken, signedIn.address);
