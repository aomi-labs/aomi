import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  mintAccountBearer,
  mintAgentApiBearer,
} from "../packages/account/src/index.ts";
import {
  AgentApiError,
  AomiClient,
  type Action,
  type Event,
  type EventPage,
} from "../packages/client/src/index.ts";

const origin = process.env.AOMI_AGENT_E2E_ORIGIN ?? "http://127.0.0.1:8082";
const backendOrigin =
  process.env.AOMI_AGENT_E2E_BACKEND_ORIGIN ?? "http://127.0.0.1:8080";
const rpcOrigin =
  process.env.AOMI_AGENT_E2E_RPC_ORIGIN ?? "http://127.0.0.1:8545";
const productRoot = process.env.AOMI_PRODUCT_ROOT;
assert.ok(
  productRoot,
  "AOMI_PRODUCT_ROOT must name the product-mono checkout under test",
);
const authFixture = readFileSync(
  join(productRoot, "aomi/bin/api-server/src/auth.rs"),
  "utf8",
).match(
  /const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/,
);
assert.ok(authFixture, "the api-server development issuer fixture is missing");
process.env.PORTAL_SERVICE_PRIVATE_KEY = authFixture[1];
process.env.BACKEND_URL = origin;
const userId =
  process.env.AOMI_AGENT_E2E_USER_ID ?? "11111111-1111-4111-8111-111111111111";
const sessionId =
  process.env.AOMI_AGENT_E2E_SESSION_ID ?? `cutover-e2e-${Date.now()}`;
const expectAction = process.env.AOMI_AGENT_E2E_EXPECT_ACTION !== "false";
const stopAtAction = process.env.AOMI_AGENT_E2E_STOP_AT_ACTION === "true";
const resumeActionId = process.env.AOMI_AGENT_E2E_RESUME_ACTION_ID;
const resumeActionRevision = Number(
  process.env.AOMI_AGENT_E2E_RESUME_ACTION_REVISION ?? "0",
);
const model = process.env.AOMI_AGENT_E2E_MODEL;
const message =
  process.env.AOMI_AGENT_E2E_MESSAGE ??
  "Send 0 ETH on chain 31337 from my connected wallet to " +
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8. " +
    "Prepare and simulate the transaction, then call commit_txs in this same turn " +
    "so the runtime emits an Action. Do not ask me for another chat message.";
const wallet = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

async function ensureWalletBound(): Promise<void> {
  const { bearer } = await mintAccountBearer(userId);
  const challenge = await fetch(
    `${backendOrigin}/api/account/authorization/challenge`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ chain_type: "evm", wallet, mode: "bind" }),
    },
  );
  if (challenge.status === 409) return;
  assert.equal(challenge.status, 200, "wallet bind challenge failed");
  const challenged = (await challenge.json()) as {
    permit: unknown;
    typed_data?: unknown;
  };
  assert.ok(challenged.typed_data, "wallet bind omitted typed data");

  const signed = await fetch(rpcOrigin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_signTypedData_v4",
      params: [wallet, JSON.stringify(challenged.typed_data)],
    }),
  });
  assert.equal(signed.status, 200, "local wallet signing failed");
  const signature = (await signed.json()) as {
    result?: string;
    error?: unknown;
  };
  assert.ok(signature.result, `local wallet signing failed: ${signature.error}`);

  const committed = await fetch(
    `${backendOrigin}/api/account/authorization/commit`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        permit: challenged.permit,
        signature: signature.result,
      }),
    },
  );
  assert.ok(
    committed.ok || committed.status === 409,
    `wallet bind commit failed with HTTP ${committed.status}`,
  );
}

const client = new AomiClient({
  baseUrl: origin,
  guest: false,
  oauth: async ({ resource, scopes }) => {
    const token = await mintAgentApiBearer(userId, {
      scope: scopes.join(" "),
      resource,
      client_id: "cutover-e2e",
      auth_source: "oauth",
      principal_class: "user",
      grant_id: "cutover-e2e",
    });
    return {
      accessToken: token.bearer,
      expiresAt: token.expiresAt * 1_000,
      resource,
      scopes,
      tokenType: "Bearer",
    };
  },
});

await ensureWalletBound();

const allEvents: Event[] = [];
let cursor: string | undefined;
let lastSequence = 0;
const publicEventTypes = new Set([
  "message",
  "turn_state_changed",
  "tool_update",
  "tool_complete",
  "task_started",
  "task_activity",
  "task_phase",
  "task_completed",
  "title_changed",
  "error",
  "action",
]);
const privateActionFields = new Set([
  "pending_tx_id",
  "pending_ix_id",
  "current_lifecycle",
  "last_batch_status",
  "fee_outcome",
  "fee_subject",
  "signed_transaction_base64",
  "broadcast_commitment",
]);

function assertPublicAction(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertPublicAction);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(
      !privateActionFields.has(key),
      `Action leaked private field ${key}`,
    );
    assertPublicAction(child);
  }
}

function assertExecutableSimulation(action: Action): void {
  if (action.request.type === "sign") return;
  assert.ok(action.request.simulation, "executable Action omitted simulation");
  assert.ok(
    ["passed", "failed"].includes(action.request.simulation.status),
    `unknown simulation status ${action.request.simulation.status}`,
  );
}

async function expectAgentError(
  label: string,
  operation: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert.ok(
      error instanceof AgentApiError,
      `${label} returned an untyped error`,
    );
    assert.equal(
      error.status,
      status,
      `${label} returned HTTP ${error.status}`,
    );
    assert.equal(error.code, code, `${label} returned ${error.code}`);
    return;
  }
  assert.fail(`${label} unexpectedly succeeded`);
}

function consume(page: EventPage): Action | undefined {
  assert.equal(page.session_id, sessionId);
  for (const event of page.events) {
    assert.ok(
      publicEventTypes.has(event.type),
      `unknown public Event ${event.type}`,
    );
    assert.ok(
      event.sequence > lastSequence,
      `event sequence ${event.sequence} did not advance past ${lastSequence}`,
    );
    if (event.type === "message") {
      assert.ok(
        ["user", "agent", "system", "notice"].includes(event.sender),
        `unknown Message sender ${event.sender}`,
      );
      assert.equal(
        event.is_streaming,
        false,
        "streaming snapshots must not be durable Events",
      );
    }
    if (event.type === "action") {
      assertPublicAction(event.request);
      assertExecutableSimulation(event);
    }
    lastSequence = event.sequence;
    allEvents.push(event);
  }
  cursor = page.cursor;
  console.log(
    JSON.stringify({
      cursor,
      events: page.events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        state: event.type === "action" ? event.state : undefined,
      })),
      hasMore: page.has_more,
    }),
  );
  return page.events.find(
    (event): event is Action =>
      event.type === "action" && event.state === "pending",
  );
}

async function pollUntil(
  predicate: (event: Event) => boolean,
): Promise<Action | undefined> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const page = await client.agent.poll(sessionId, {
      cursor,
      waitMs: 30_000,
    });
    const action = consume(page);
    if (page.events.some(predicate)) return action;
  }
  throw new Error("timed out waiting for the expected Agent event");
}

if (resumeActionId) {
  const resolved = await client.agent.respondToAction(
    sessionId,
    resumeActionId,
    resumeActionRevision,
    { status: "rejected", reason: "cutover_e2e_restart_rejection" },
    `restart-${sessionId}-${resumeActionId}`,
  );
  assert.equal(resolved.id, resumeActionId);
  assert.equal(resolved.revision, resumeActionRevision + 1);
  assert.equal(resolved.state, "rejected");
  await pollUntil(
    (event) =>
      event.type === "turn_state_changed" &&
      ["complete", "failed", "interrupted"].includes(event.state),
  );
  const lifecycle = allEvents
    .filter((event) => event.type === "turn_state_changed")
    .map((event) => event.state);
  assert.ok(lifecycle.includes("processing"));
  assert.ok(lifecycle.includes("awaiting_action"));
  assert.ok(
    lifecycle.some((state) =>
      ["complete", "failed", "interrupted"].includes(state),
    ),
  );
  console.log(
    JSON.stringify({
      result: "restart-pass",
      sessionId,
      actionId: resumeActionId,
      lifecycle,
    }),
  );
  process.exit(0);
}

const first = await client.agent.start(
  {
    sessionId,
    applicationId: 8,
    model,
    message,
    userState: {
      connection: { is_connected: true, provider: "para" },
      evm: {
        chain_id: 31337,
        address: wallet,
      },
      ext: { client_type: "web_ui" },
    },
  },
  { idempotencyKey: `start-${sessionId}` },
);

let action = consume(first);
if (!action) {
  action = await pollUntil(
    (event) =>
      event.type === "action" ||
      (event.type === "turn_state_changed" &&
        ["complete", "failed", "interrupted"].includes(event.state)),
  );
}
if (!expectAction) {
  const lifecycle = allEvents
    .filter((event) => event.type === "turn_state_changed")
    .map((event) => event.state);
  assert.ok(
    lifecycle.some((state) =>
      ["complete", "failed", "interrupted"].includes(state),
    ),
  );
  console.log(JSON.stringify({ result: "pass", sessionId, lifecycle }));
  process.exit(0);
}
assert.ok(
  action,
  "the runtime reached a terminal state without emitting an Action",
);
if (stopAtAction) {
  console.log(
    JSON.stringify({
      result: "action-checkpoint",
      sessionId,
      actionId: action.id,
      actionRevision: action.revision,
      cursor,
    }),
  );
  process.exit(0);
}

await expectAgentError(
  "malformed cursor",
  () => client.agent.poll(sessionId, { cursor: "not-an-event-cursor" }),
  400,
  "invalid_cursor",
);
const recovered = await client.agent.poll(sessionId);
assert.equal(recovered.session_id, sessionId);
assert.ok(
  recovered.events.length > 0,
  "cursorless recovery returned no ledger events",
);

await expectAgentError(
  "incorrect Action revision",
  () =>
    client.agent.respondToAction(
      sessionId,
      action.id,
      action.revision + 1,
      { status: "rejected", reason: "cutover_e2e_wrong_revision" },
      `wrong-revision-${sessionId}-${action.id}`,
    ),
  409,
  "action_conflict",
);

const responseKey = `respond-${sessionId}-${action.id}`;
const resolved = await client.agent.respondToAction(
  sessionId,
  action.id,
  action.revision,
  { status: "rejected", reason: "cutover_e2e_rejection" },
  responseKey,
);
assert.equal(resolved.id, action.id);
assert.equal(resolved.revision, action.revision + 1);
assert.equal(resolved.state, "rejected");
const replayed = await client.agent.respondToAction(
  sessionId,
  action.id,
  action.revision,
  { status: "rejected", reason: "cutover_e2e_rejection" },
  responseKey,
);
assert.deepEqual(
  replayed,
  resolved,
  "duplicate response did not replay idempotently",
);

await pollUntil(
  (event) =>
    event.type === "turn_state_changed" &&
    ["complete", "failed", "interrupted"].includes(event.state),
);

const lifecycle = allEvents
  .filter((event) => event.type === "turn_state_changed")
  .map((event) => event.state);
assert.ok(lifecycle.includes("processing"));
assert.ok(lifecycle.includes("awaiting_action"));
assert.ok(
  lifecycle.some((state) =>
    ["complete", "failed", "interrupted"].includes(state),
  ),
);

console.log(
  JSON.stringify({
    result: "pass",
    sessionId,
    actionId: action.id,
    eventCount: allEvents.length,
    lifecycle,
  }),
);
