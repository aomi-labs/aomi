/**
 * Transaction routing matrix, driven over the wire against a local backend
 * (:8080) and api-server (:8082). Every cell of Broadcaster × execution ×
 * Manual/Auto is exercised with the userState variant a real client would
 * send, and the observed outcome is compared with the routing contract:
 *
 *   - a pending Action with the expected `request.type`, or
 *   - a typed commit-gate error (`[err.type=…]`), or
 *   - an api-server 400 for an invalid userState.
 *
 * Stage 1 uses the Pipeline V2 API (deterministic, no model). Stage 2 sends
 * Agent turns (model-driven; the prompt asks for commit_txs in-turn). Stage 3
 * runs the permit negatives. One JSON line per cell is written to stdout:
 * `{ cell, expected, observed, verdict }`.
 *
 * Preconditions (see the plan, Part B / T2): backend + api-server running with
 * the dev issuer fixture, local Postgres reachable, Anvil on :8545 (chain
 * 31337), and — for Auto lanes — `PARA_SECRET_API_KEY` on the backend so a
 * Para agent wallet can be provisioned. Lanes whose preconditions are missing
 * are reported as `verdict: "blocked"`, never as pass.
 *
 * Usage:
 *   AOMI_PRODUCT_ROOT=/path/to/product-mono \
 *   node --experimental-strip-types scripts/routing-matrix-e2e.mts \
 *     | tee output/routing-program/t2/matrix.jsonl
 *
 * Env: AOMI_AGENT_E2E_ORIGIN (api-server), AOMI_AGENT_E2E_BACKEND_ORIGIN,
 * AOMI_AGENT_E2E_RPC_ORIGIN, AOMI_ROUTING_APPLICATION_ID (default 8),
 * AOMI_ROUTING_STAGES (comma list of 1,2,3; default all), AOMI_AGENT_E2E_MODEL.
 */
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
const applicationId = Number(process.env.AOMI_ROUTING_APPLICATION_ID ?? "8");
const model = process.env.AOMI_AGENT_E2E_MODEL;
const stages = new Set(
  (process.env.AOMI_ROUTING_STAGES ?? "1,2,3").split(",").map((s) => s.trim()),
);

/** Anvil #0 ("Alice") and #1 ("Bob"). Keys never leave Anvil: signing goes
 * through `eth_signTypedData_v4` on the node. */
const MANUAL_WALLET = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const BOB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const DENIED_WALLET = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const CHAIN_ID = 31337;

const AGENT_SCOPES = "agent:read agent:write agent:actions:resolve";
const CUSTODY = "custody:delegate";
const PIPELINE_SCOPES = "pipeline:catalog pipeline:execute";

/** Deterministic per-lane users so signing modes never collide. */
const users = {
  manual: "33333333-3333-4333-8333-333333333333",
  auto: "22222222-2222-4222-8222-222222222222",
  denied: "44444444-4444-4444-8444-444444444444",
  nocustody: "22222222-2222-4222-8222-222222222222",
} as const;

type Verdict = "pass" | "fail" | "blocked";
type Row = {
  cell: string;
  expected: string;
  observed: string;
  verdict: Verdict;
  note?: string;
};
const rows: Row[] = [];
function report(row: Row): void {
  rows.push(row);
  console.log(JSON.stringify(row));
}

// ---------------------------------------------------------------------------
// Account helpers (backend :8080, account bearer)
// ---------------------------------------------------------------------------

async function accountFetch(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const { bearer } = await mintAccountBearer(userId);
  return fetch(`${backendOrigin}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function anvilSignTypedData(
  signer: string,
  typedData: unknown,
): Promise<string> {
  const response = await fetch(rpcOrigin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_signTypedData_v4",
      params: [signer, JSON.stringify(typedData)],
    }),
  });
  const body = (await response.json()) as { result?: string; error?: unknown };
  assert.ok(body.result, `anvil signing failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

type Challenge = { permit: unknown; typed_data?: unknown };

/** Run challenge → sign (with `signer`, on Anvil) → commit for `wallet`.
 * Returns the commit response so callers can assert typed errors. */
async function permit(
  userId: string,
  wallet: string,
  mode: "bind" | "manual" | "client_auto" | "server_auto" | "denied",
  signer: string = wallet,
): Promise<{
  challenge: Response;
  commit?: Response;
  permit?: unknown;
  signature?: string;
  signer?: string;
}> {
  const challenge = await accountFetch(
    userId,
    "/api/account/authorization/challenge",
    {
      method: "POST",
      body: JSON.stringify({ chain_type: "evm", wallet, mode }),
    },
  );
  if (!challenge.ok) return { challenge };
  const challenged = (await challenge.json()) as Challenge;
  assert.ok(challenged.typed_data, "challenge omitted typed data");
  const signature = await anvilSignTypedData(signer, challenged.typed_data);
  const commit = await accountFetch(
    userId,
    "/api/account/authorization/commit",
    {
      method: "POST",
      body: JSON.stringify({
        permit: challenged.permit,
        signature,
        signer,
      }),
    },
  );
  return { challenge, commit, permit: challenged.permit, signature, signer };
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error === "object") {
      const code = (body.error as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
  } catch {
    // fall through
  }
  return `http_${response.status}`;
}

async function profile(userId: string): Promise<{
  signing_policies: Array<{ address: { address: string }; mode: string }>;
  delegated_accounts: Array<{
    address: { address: string };
    status: string;
    delegation_provider: string;
  }>;
  user_accounts: Array<{
    address: { address: string };
    auth_provider?: string;
  }>;
}> {
  const response = await accountFetch(userId, "/api/account");
  assert.equal(response.status, 200, `GET /api/account ${response.status}`);
  return (await response.json()) as never;
}

async function bindAndSet(
  userId: string,
  mode: "manual" | "denied",
  wallet: string,
): Promise<void> {
  const bound = await permit(userId, wallet, "bind");
  assert.ok(
    bound.challenge.status === 409 ||
      (bound.commit && (bound.commit.ok || bound.commit.status === 409)),
    `bind for ${userId} failed: ${bound.challenge.status}/${bound.commit?.status}`,
  );
  const current = (await profile(userId)).signing_policies.find(
    (row) => row.address.address.toLowerCase() === wallet.toLowerCase(),
  );
  if (current?.mode === (mode === "manual" ? "manual" : "denied")) return;
  const set = await permit(userId, wallet, mode);
  assert.ok(
    set.commit?.ok,
    `set ${mode} for ${userId} failed: ${set.challenge.status}/${set.commit?.status} ${
      set.commit ? await errorCode(set.commit) : ""
    }`,
  );
}

/** Provision a Para agent wallet and arm it as server_auto. Returns the agent
 * address, or undefined (with a reason) when the provider is not configured. */
async function provisionAuto(
  userId: string,
): Promise<{ agent?: string; reason?: string }> {
  await bindAndSet(userId, "manual", BOB);
  const provisioned = await accountFetch(
    userId,
    "/api/account/providers/para/agent-wallet",
    {
      method: "POST",
      body: JSON.stringify({
        application_id: applicationId,
        chain_type: "evm",
      }),
    },
  );
  if (!provisioned.ok) {
    return {
      reason: `agent-wallet ${provisioned.status} ${await errorCode(provisioned)} (PARA_SECRET_API_KEY missing?)`,
    };
  }
  const { address: agent } = (await provisioned.json()) as { address: string };
  const snapshot = await profile(userId);
  const delegated = snapshot.delegated_accounts.some(
    (row) =>
      row.address.address.toLowerCase() === agent.toLowerCase() &&
      row.status === "active",
  );
  if (!delegated) {
    return {
      agent,
      reason:
        "no active signing_delegations row for the agent wallet; seed it (plan T2) and rerun",
    };
  }
  const armed = snapshot.signing_policies.find(
    (row) => row.address.address.toLowerCase() === agent.toLowerCase(),
  );
  if (armed?.mode !== "auto") {
    // A provider-managed key is loosened by a linked sibling key.
    const set = await permit(userId, agent, "server_auto", BOB);
    if (!set.commit?.ok) {
      return {
        agent,
        reason: `server_auto commit ${set.commit?.status ?? set.challenge.status} ${
          set.commit
            ? await errorCode(set.commit)
            : await errorCode(set.challenge)
        }`,
      };
    }
  }
  return { agent };
}

// ---------------------------------------------------------------------------
// Agent / Pipeline clients (api-server :8082)
// ---------------------------------------------------------------------------

function agentClient(userId: string, scope: string): AomiClient {
  return new AomiClient({
    baseUrl: origin,
    guest: false,
    oauth: async ({ resource, scopes }) => {
      const token = await mintAgentApiBearer(userId, {
        scope,
        resource,
        client_id: "routing-matrix-e2e",
        auth_source: "oauth",
        principal_class: "user",
        grant_id: "routing-matrix-e2e",
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
}

const PROMPT =
  `Send 0 ETH on chain ${CHAIN_ID} from my connected wallet to ${BOB}. ` +
  "Prepare and simulate the transaction, then call commit_txs in this same turn " +
  "so the runtime emits an Action. Do not ask me for another chat message.";

type Outcome =
  | { kind: "confirmed"; txHashes: string[] }
  | { kind: "action"; action: Action }
  | { kind: "error"; code: string; text: string }
  | { kind: "terminal"; state: string; text: string }
  | { kind: "http"; status: number; code: string };

function toolErrorCode(event: Event): string | undefined {
  if (event.type !== "tool_complete") return undefined;
  const text = JSON.stringify(event);
  const match = text.match(/err\.type=([a-z_]+)/);
  return match?.[1];
}

function confirmed(
  result: unknown,
): result is { status: "confirmed"; tx_hashes: string[] } {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === "confirmed" &&
    "tx_hashes" in result &&
    Array.isArray(result.tx_hashes) &&
    result.tx_hashes.length > 0 &&
    result.tx_hashes.every(
      (hash: unknown) =>
        typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash),
    )
  );
}

async function runTurn(
  client: AomiClient,
  sessionId: string,
  userState: Record<string, unknown>,
): Promise<Outcome> {
  let cursor: string | undefined;
  const seen: Event[] = [];
  const consume = (page: EventPage): Outcome | undefined => {
    cursor = page.cursor;
    for (const event of page.events) {
      seen.push(event);
      if (event.type === "action" && event.state === "pending") {
        return { kind: "action", action: event as Action };
      }
      const code = toolErrorCode(event);
      if (code) return { kind: "error", code, text: JSON.stringify(event) };
      if (
        event.type === "tool_complete" &&
        event.tool_name === "evm_commit_txs"
      ) {
        const result: unknown =
          typeof event.result === "string"
            ? JSON.parse(event.result)
            : event.result;
        if (confirmed(result)) {
          return { kind: "confirmed", txHashes: result.tx_hashes };
        }
      }
      if (
        event.type === "turn_state_changed" &&
        ["complete", "failed", "interrupted"].includes(event.state)
      ) {
        return {
          kind: "terminal",
          state: event.state,
          text: JSON.stringify(seen.slice(-6)),
        };
      }
    }
    return undefined;
  };
  try {
    const first = await client.agent.start(
      {
        sessionId,
        applicationId,
        model,
        message: PROMPT,
        userState,
      },
      { idempotencyKey: `start-${sessionId}` },
    );
    const early = consume(first);
    if (early) return early;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const page = await client.agent.poll(sessionId, {
        cursor,
        waitMs: 30_000,
      });
      const outcome = consume(page);
      if (outcome) return outcome;
    }
    return { kind: "terminal", state: "timeout", text: "" };
  } catch (error) {
    if (error instanceof AgentApiError) {
      return { kind: "http", status: error.status, code: error.code };
    }
    throw error;
  }
}

function judge(
  cell: string,
  outcome: Outcome,
  expect:
    | { action: "execute_evm" | "execute_svm" | "sign"; aa?: boolean }
    | { error: string }
    | { http: number }
    | { confirmed: true },
): Verdict {
  const observed =
    outcome.kind === "confirmed"
      ? `confirmed:${outcome.txHashes.join(",")}`
      : outcome.kind === "action"
        ? `action:${outcome.action.request.type}${
            outcome.action.request.type === "sign"
              ? `:${outcome.action.request.executionKind}:${outcome.action.request.broadcaster ?? "-"}`
              : ""
          }`
        : outcome.kind === "error"
          ? `error:${outcome.code}`
          : outcome.kind === "http"
            ? `http:${outcome.status}:${outcome.code}`
            : `terminal:${outcome.state}`;
  let expected: string;
  let verdict: Verdict;
  if ("action" in expect) {
    expected = `action:${expect.action}${expect.aa ? ":erc4337:hosted" : ""}`;
    verdict =
      outcome.kind === "action" &&
      outcome.action.request.type === expect.action &&
      (!expect.aa ||
        (outcome.action.request.type === "sign" &&
          outcome.action.request.executionKind === "erc4337" &&
          Boolean(outcome.action.request.operationId) &&
          outcome.action.request.broadcaster === "hosted"))
        ? "pass"
        : "fail";
  } else if ("error" in expect) {
    expected = `error:${expect.error}`;
    verdict =
      outcome.kind === "error" && outcome.code === expect.error
        ? "pass"
        : "fail";
  } else if ("http" in expect) {
    expected = `http:${expect.http}`;
    verdict =
      outcome.kind === "http" && outcome.status === expect.http
        ? "pass"
        : "fail";
  } else {
    expected =
      "evm_commit_txs confirmed with transaction hashes and no caller Action";
    verdict = outcome.kind === "confirmed" ? "pass" : "fail";
  }
  report({ cell, expected, observed, verdict });
  return verdict;
}

// ---------------------------------------------------------------------------
// Stage 1: Pipeline V2
// ---------------------------------------------------------------------------

async function stage1(auto: {
  agent?: string;
  reason?: string;
}): Promise<void> {
  const call = {
    to: BOB as `0x${string}`,
    data: "0x" as `0x${string}`,
    value: "1",
    gas: "21000",
    description: "1 wei routing probe",
  };
  const action = {
    to: call.to,
    description: call.description,
    data: { signature: "", args: [], raw: call.data },
    chain_id: CHAIN_ID,
    value: call.value,
    gas_limit: call.gas,
  };
  const manual = agentClient(users.manual, `${PIPELINE_SCOPES} ${CUSTODY}`);
  try {
    const staged = await manual.pipeline.evm.stage({
      actions: [action],
    });
    const build = await manual.pipeline.evm.simulate(staged);
    // Tamper: same digest, different action → attestation must reject.
    const tampered = {
      ...build,
      actions: [{ ...build.actions[0], value: "2" }],
    };
    try {
      await manual.pipeline.evm.commit(tampered as never, {
        idempotencyKey: `tamper-${crypto.randomUUID()}`,
      });
      report({
        cell: "P2-4 tampered build",
        expected: "422 pipeline_build_rejected integrity rejection",
        observed: "committed",
        verdict: "fail",
      });
    } catch (error) {
      const pipeline = error as {
        status?: number;
        code?: string;
        details?: unknown;
      };
      const details = JSON.stringify(pipeline.details ?? null);
      report({
        cell: "P2-4 tampered build",
        expected: "422 pipeline_build_rejected integrity rejection",
        observed:
          `http:${pipeline.status ?? 0} ${pipeline.code ?? "unknown"} ` +
          details.slice(0, 160),
        verdict:
          pipeline.status === 422 &&
          pipeline.code === "backend_rejected" &&
          details.includes("pipeline_build_rejected") &&
          /(digest|attestation)/i.test(details)
            ? "pass"
            : "fail",
      });
    }
    const committed = await manual.pipeline.evm.commit(build);
    const request = committed.requests[0] as { type?: string } | undefined;
    report({
      cell: "P2-1 stage→simulate→commit Manual",
      expected: "committed with an execute_evm request",
      observed: `${committed.status}:${request?.type ?? "no-request"}`,
      verdict:
        committed.status === "committed" && request?.type === "execute_evm"
          ? "pass"
          : "fail",
    });
  } catch (error) {
    report({
      cell: "P2-1 stage→simulate→commit Manual",
      expected: "committed",
      observed: String((error as Error).message ?? error),
      verdict: "fail",
    });
  }

  const denied = agentClient(users.denied, `${PIPELINE_SCOPES} ${CUSTODY}`);
  try {
    const staged = await denied.pipeline.evm.stage({
      actions: [action],
    });
    const build = await denied.pipeline.evm.simulate(staged);
    await denied.pipeline.evm.commit(build);
    report({
      cell: "P2-3 commit Denied",
      expected: "pipeline_commit_failed",
      observed: "committed",
      verdict: "fail",
    });
  } catch (error) {
    const pipeline = error as {
      status?: number;
      code?: string;
      details?: unknown;
    };
    const details = JSON.stringify(pipeline.details ?? null);
    report({
      cell: "P2-3 commit Denied",
      expected: "422 backend_rejected with pipeline_commit_failed",
      observed:
        `http:${pipeline.status ?? 0} ${pipeline.code ?? "unknown"} ` +
        details.slice(0, 160),
      verdict:
        pipeline.status === 422 &&
        pipeline.code === "backend_rejected" &&
        details.includes("pipeline_commit_failed")
          ? "pass"
          : "fail",
    });
  }

  const guest = await fetch(`${origin}/v1/pipeline/evm/stage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `guest-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ actions: [action] }),
  });
  report({
    cell: "P2-5 guest stage",
    expected: "401/403",
    observed: `http:${guest.status}`,
    verdict: guest.status === 401 || guest.status === 403 ? "pass" : "fail",
  });

  if (!auto.agent) {
    report({
      cell: "P2-2 commit Auto (hosted)",
      expected: "confirmed with transaction hashes and no caller requests",
      observed: auto.reason ?? "no agent wallet",
      verdict: "blocked",
    });
    report({
      cell: "P2-6 Auto without custody scope",
      expected: "signing_delegated_custody_scope_required",
      observed: auto.reason ?? "no agent wallet",
      verdict: "blocked",
    });
    return;
  }
  for (const [cell, scope, expected] of [
    ["P2-2 commit Auto (hosted)", `${PIPELINE_SCOPES} ${CUSTODY}`, "confirmed"],
    [
      "P2-6 Auto without custody scope",
      PIPELINE_SCOPES,
      "signing_delegated_custody_scope_required",
    ],
  ] as const) {
    const client = agentClient(users.auto, scope);
    try {
      const staged = await client.pipeline.evm.stage({
        actions: [action],
      });
      const build = await staged.simulate();
      const committed = await build.commit();
      report({
        cell,
        expected,
        observed: `committed:${committed.status}`,
        verdict:
          expected === "confirmed" &&
          committed.status === "committed" &&
          committed.requests.length === 0 &&
          confirmed(committed.result)
            ? "pass"
            : "fail",
      });
    } catch (error) {
      const text = String((error as Error).message ?? error);
      const routing = text.match(/(broadcaster_[a-z_]+|signing_[a-z_]+)/)?.[1];
      report({
        cell,
        expected,
        observed: routing ? `error:${routing}` : text.slice(0, 160),
        verdict:
          expected !== "confirmed" && routing === expected ? "pass" : "fail",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Agent chat, one userState variant per cell
// ---------------------------------------------------------------------------

async function stage2(auto: {
  agent?: string;
  reason?: string;
}): Promise<void> {
  const manual = agentClient(users.manual, `${AGENT_SCOPES} ${CUSTODY}`);
  const denied = agentClient(users.denied, `${AGENT_SCOPES} ${CUSTODY}`);
  const guest = new AomiClient({ baseUrl: origin, guest: true });
  const run = (
    client: AomiClient,
    cell: string,
    evm: Record<string, unknown>,
    ext?: Record<string, unknown>,
  ) =>
    runTurn(
      client,
      `routing-${Date.now()}-${cell.replace(/[^a-z0-9]+/gi, "-")}`,
      {
        connection: { is_connected: true, provider: "para" },
        evm,
        ...(ext ? { ext } : {}),
      },
    );

  judge(
    "E-Wallet-noAA-Manual (explicit wallet)",
    await run(manual, "wallet-explicit", {
      address: MANUAL_WALLET,
      chain_id: CHAIN_ID,
      broadcaster: "wallet",
    }),
    { action: "execute_evm" },
  );
  judge(
    "E-Wallet-noAA-Manual (no selection)",
    await run(manual, "wallet-default", {
      address: MANUAL_WALLET,
      chain_id: CHAIN_ID,
    }),
    { action: "execute_evm" },
  );
  judge(
    "E-Hosted-noAA-Manual",
    await run(manual, "hosted-manual", {
      address: MANUAL_WALLET,
      chain_id: CHAIN_ID,
      broadcaster: "hosted",
    }),
    { error: "broadcaster_unsupported_for_chain" },
  );
  judge(
    "E-Venue-noAA-Manual",
    await run(manual, "venue-manual", {
      address: MANUAL_WALLET,
      chain_id: CHAIN_ID,
      broadcaster: "venue",
    }),
    { error: "broadcaster_unsupported_for_chain" },
  );
  judge(
    "TG Manual (address+chain_id only)",
    await run(
      manual,
      "tg-manual",
      { address: MANUAL_WALLET, chain_id: CHAIN_ID },
      {
        telegram: { requires_action_approval: true },
      },
    ),
    { action: "execute_evm" },
  );
  judge(
    "Denied",
    await run(denied, "denied", { address: DENIED_WALLET, chain_id: CHAIN_ID }),
    { error: "signing_denied" },
  );
  judge(
    "Guest unbound",
    await run(guest, "guest-unbound", { address: BOB, chain_id: CHAIN_ID }),
    { error: "signing_unbound_wallet" },
  );
  judge(
    "Invalid broadcaster (string)",
    await run(manual, "invalid-aomi", {
      address: MANUAL_WALLET,
      chain_id: CHAIN_ID,
      broadcaster: "aomi",
    }),
    { http: 400 },
  );
  judge(
    "Invalid broadcaster (bool)",
    await run(manual, "invalid-bool", {
      address: MANUAL_WALLET,
      chain_id: CHAIN_ID,
      broadcaster: true,
    }),
    { http: 400 },
  );

  if (!auto.agent) {
    for (const cell of [
      "E-Wallet-noAA-Auto (explicit wallet)",
      "E-Hosted-noAA-Auto",
      "E-Venue-noAA-Auto",
      "TG Auto (no selection → hosted)",
      "Guest on server_auto key",
      "Auto without custody scope",
    ]) {
      report({
        cell,
        expected: "see plan T2",
        observed: auto.reason ?? "no agent wallet",
        verdict: "blocked",
      });
    }
    return;
  }
  const agent = auto.agent;
  const autoClient = agentClient(users.auto, `${AGENT_SCOPES} ${CUSTODY}`);
  const noCustody = agentClient(users.nocustody, AGENT_SCOPES);
  judge(
    "E-Wallet-noAA-Auto (explicit wallet)",
    await run(autoClient, "auto-wallet", {
      address: agent,
      chain_id: CHAIN_ID,
      broadcaster: "wallet",
    }),
    { error: "broadcaster_incompatible" },
  );
  judge(
    "E-Hosted-noAA-Auto",
    await run(autoClient, "auto-hosted", {
      address: agent,
      chain_id: CHAIN_ID,
      broadcaster: "hosted",
    }),
    { confirmed: true },
  );
  judge(
    "E-Venue-noAA-Auto",
    await run(autoClient, "auto-venue", {
      address: agent,
      chain_id: CHAIN_ID,
      broadcaster: "venue",
    }),
    { error: "broadcaster_unsupported_for_chain" },
  );
  judge(
    "TG Auto (no selection → hosted)",
    await run(
      autoClient,
      "tg-auto",
      { address: agent, chain_id: CHAIN_ID },
      {
        telegram: { requires_action_approval: true },
      },
    ),
    // Telegram approval is enforced before broadcaster resolution; this
    // checks that fence, not the default submitter.
    { error: "signing_action_approval_required" },
  );
  judge(
    "Guest on server_auto key",
    await run(guest, "guest-auto", { address: agent, chain_id: CHAIN_ID }),
    { error: "signing_auto_requires_account" },
  );
  judge(
    "Auto without custody scope",
    await run(noCustody, "auto-nocustody", {
      address: agent,
      chain_id: CHAIN_ID,
      broadcaster: "hosted",
    }),
    { error: "signing_delegated_custody_scope_required" },
  );
}

// ---------------------------------------------------------------------------
// Stage 3: permit negatives
// ---------------------------------------------------------------------------

async function stage3(auto: { agent?: string }): Promise<void> {
  // Replay: commit the same permit twice → 409 stale_permit.
  const first = await permit(users.manual, MANUAL_WALLET, "manual");
  assert.ok(
    first.commit && first.signature && first.signer,
    "manual permit challenge failed",
  );
  const replayed = await accountFetch(
    users.manual,
    "/api/account/authorization/commit",
    {
      method: "POST",
      body: JSON.stringify({
        permit: first.permit,
        signature: first.signature,
        signer: first.signer,
      }),
    },
  );
  report({
    cell: "Permit replay",
    expected: "409 stale_permit",
    observed: `${replayed.status} ${await errorCode(replayed)}`,
    verdict:
      replayed.status === 409 && (await errorCode(replayed)) === "stale_permit"
        ? "pass"
        : "fail",
  });

  // Foreign signer on a loosening change → 403 wrong_signer.
  const foreign = await permit(users.manual, MANUAL_WALLET, "client_auto", BOB);
  const foreignCode = foreign.commit ? await errorCode(foreign.commit) : "";
  report({
    cell: "Foreign signer loosen",
    expected: "403 wrong_signer",
    observed: `${foreign.commit?.status ?? foreign.challenge.status} ${foreignCode}`,
    verdict:
      foreign.commit?.status === 403 && foreignCode === "wrong_signer"
        ? "pass"
        : "fail",
  });

  // server_auto on a key without a delegation → 409 missing_delegated_account
  // (fails fast at challenge time).
  const missing = await permit(users.manual, MANUAL_WALLET, "server_auto");
  const missingCode = await errorCode(missing.challenge);
  report({
    cell: "server_auto without delegation",
    expected:
      "409 missing_delegated_account (or 422 mode_illegal_for_provider for a non-delegating identity)",
    observed: `${missing.challenge.status} ${missingCode}`,
    verdict:
      (missing.challenge.status === 409 &&
        missingCode === "missing_delegated_account") ||
      (missing.challenge.status === 422 &&
        missingCode === "mode_illegal_for_provider")
        ? "pass"
        : "fail",
  });

  if (auto.agent) {
    const illegal = await permit(
      users.auto,
      auto.agent,
      "manual",
      MANUAL_WALLET,
    );
    const code = await errorCode(illegal.challenge);
    report({
      cell: "manual on provider-managed key",
      expected: "422 mode_illegal_for_provider",
      observed: `${illegal.challenge.status} ${code}`,
      verdict:
        illegal.challenge.status === 422 && code === "mode_illegal_for_provider"
          ? "pass"
          : "fail",
    });
  }
}

// ---------------------------------------------------------------------------

// Exercise the verdicts without credentials, provisioning, or network calls.
if (process.argv.includes("--self-test")) {
  const hash = `0x${"1".repeat(64)}`;
  for (const [tool_name, result, verdict] of [
    ["evm_commit_txs", { status: "confirmed", tx_hashes: [hash] }, "pass"],
    ["evm_stage_tx", { status: "confirmed", tx_hashes: [hash] }, "fail"],
    ["evm_commit_txs", { status: "confirmed", tx_hashes: [] }, "fail"],
    ["evm_commit_txs", { status: "confirmed", tx_hashes: ["invalid"] }, "fail"],
  ] as const) {
    const client = {
      agent: {
        start: async () => ({
          events: [
            { type: "tool_complete", tool_name, result },
            { type: "turn_state_changed", state: "complete" },
          ],
        }),
      },
    } as unknown as AomiClient;
    const outcome = await runTurn(client, "fixture", {});
    assert.equal(judge(tool_name, outcome, { confirmed: true }), verdict);
  }
  for (const outcome of [
    { kind: "http", status: 500, code: "internal" },
    { kind: "error", code: "simulation_failed", text: "" },
    { kind: "error", code: "signing_denied", text: "" },
    { kind: "terminal", state: "complete", text: "no commit" },
    { kind: "action", action: { request: { type: "execute_evm" } } as Action },
  ] satisfies Outcome[]) {
    assert.equal(judge(outcome.kind, outcome, { confirmed: true }), "fail");
  }
  console.log("Routing verdict self-test passed");
  process.exit(0);
}

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

const health = await fetch(`${backendOrigin}/health`).catch(() => undefined);
assert.ok(health?.ok, `backend ${backendOrigin} is not healthy`);
const ready = await fetch(`${origin}/ready`).catch(() => undefined);
assert.ok(ready?.ok, `api-server ${origin} is not ready`);

await bindAndSet(users.manual, "manual", MANUAL_WALLET);
await bindAndSet(users.denied, "denied", DENIED_WALLET);
const auto = await provisionAuto(users.auto);
if (auto.reason) console.error(`[routing-matrix] Auto lanes: ${auto.reason}`);

if (stages.has("1")) await stage1(auto);
if (stages.has("2")) await stage2(auto);
if (stages.has("3")) await stage3(auto);

const summary = rows.reduce(
  (acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }),
  {} as Record<Verdict, number>,
);
console.error(`[routing-matrix] ${JSON.stringify(summary)}`);
process.exit(summary.fail ? 1 : 0);
