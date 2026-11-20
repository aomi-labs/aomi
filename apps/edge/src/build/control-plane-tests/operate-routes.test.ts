// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "@aomi-labs/deploy";

import {
  operateAgentDetailRoute,
  operateChannelsRoute,
  operateChannelsCommandSecretRoute,
  operateChannelsCreateRoute,
  operateChannelsDeleteRoute,
  operateChannelsUpdateRoute,
  operateChannelsWebhookRoute,
  operateLogsRoute,
  operateModelKeysRoute,
  operateObservabilityRoute,
  operatePaymentsRoute,
  operateTransactionsRoute,
  operateUsageRoute,
} from "./routes";
import { getGitHubSession } from "./harness";

const client = {
  listUserProjects: vi.fn(),
  listUserChannels: vi.fn(),
  createUserChannel: vi.fn(),
  updateUserChannel: vi.fn(),
  revealUserChannelCommandSecret: vi.fn(),
  checkUserChannelWebhook: vi.fn(),
  deleteUserChannel: vi.fn(),
  listBuilderModelKeys: vi.fn(),
  getUserObservability: vi.fn(),
  getUserPayments: vi.fn(),
  getBuilderAgentDetail: vi.fn(),
  listUserTransactions: vi.fn(),
  getUserStatements: vi.fn(),
  getUserUsage: vi.fn(),
  listUserLogs: vi.fn(),
};

vi.mock("../manager-client", async (original) => ({
  ...(await original<typeof import("../manager-client")>()),
  managerClient: async () => client,
}));

function getReq(qs = "") {
  return new Request(`http://localhost:3000/api/build/operate/channels${qs}`);
}

function postJson(body: unknown) {
  return new Request("http://localhost:3000/api/build/operate/channels", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function patchJson(body: unknown) {
  return new Request("http://localhost:3000/api/build/operate/channels", {
    method: "PATCH",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function commandSecretReq(channelId: string) {
  return new Request(
    `http://localhost:3000/api/build/operate/channels/${channelId}/command-secret`,
  );
}

function webhookReq(channelId: string) {
  return new Request(
    `http://localhost:3000/api/build/operate/channels/${channelId}/webhook`,
    { method: "POST", headers: { origin: "http://localhost:3000" } },
  );
}

function deleteReq(qs: string) {
  return new Request(`http://localhost:3000/api/build/operate/channels${qs}`, {
    method: "DELETE",
    headers: { origin: "http://localhost:3000" },
  });
}

function setSession(overrides: { githubUserId: string }) {
  getGitHubSession.mockResolvedValue({
    githubUserId: overrides.githubUserId,
    githubLogin: "alice",
  });
}

function clearSession() {
  getGitHubSession.mockResolvedValue(null);
}

beforeEach(() => {
  for (const mock of Object.values(client)) mock.mockReset();
  getGitHubSession.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("operateChannelsRoute", () => {
  it("401s the channels list when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateChannelsRoute(getReq());
    expect(res.status).toBe(401);
    expect(client.listUserChannels).not.toHaveBeenCalled();
  });

  it("lists the builder's channels with the agents its publisher owns", async () => {
    setSession({ githubUserId: "gh-1" });
    const agents = [
      { id: 77, slug: "alice/world", label: "World", projectId: 42 },
      { id: 78, slug: "alice/solo", label: "Solo", projectId: null },
    ];
    client.listUserChannels.mockResolvedValue({
      channels: [{ id: "b1", platformUsername: "mybot" }],
      agents,
    });
    const res = await operateChannelsRoute(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      channels: [{ id: "b1", platformUsername: "mybot" }],
      agents,
    });
    expect(client.listUserChannels).toHaveBeenCalledWith({
      githubUserId: "gh-1",
    });
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("logs a manager 5xx without creating a BFF Issue", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserChannels.mockRejectedValue(
      new BackendError("list_user_bots", 503, "failed", "private backend body"),
    );

    const res = await operateChannelsRoute(getReq());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "failed" });
  });
});

describe("operateChannelsCreateRoute", () => {
  it("401s create when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateChannelsCreateRoute(
      postJson({
        agentId: 1,
        credential: "t",
      }),
    );
    expect(res.status).toBe(401);
    expect(client.createUserChannel).not.toHaveBeenCalled();
  });

  it("leaves agent ownership to the manager", async () => {
    setSession({ githubUserId: "gh-1" });
    client.createUserChannel.mockRejectedValue(
      new BackendError(
        "create_user_bot",
        403,
        "create_user_bot failed (403)",
        JSON.stringify({ error: "agent is not yours" }),
      ),
    );
    const res = await operateChannelsCreateRoute(
      postJson({
        agentId: 1,
        credential: "t",
      }),
    );
    expect(res.status).toBe(403);
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("400s an invalid body before calling the backend", async () => {
    setSession({ githubUserId: "gh-1" });
    let res = await operateChannelsCreateRoute(
      postJson({
        agentId: "nope",
        credential: "t",
      }),
    );
    expect(res.status).toBe(400);

    res = await operateChannelsCreateRoute(
      postJson({
        agentId: 1,
        credential: "   ",
      }),
    );
    expect(res.status).toBe(400);
    expect(client.createUserChannel).not.toHaveBeenCalled();
  });

  it("creates a channel with one owned agent", async () => {
    setSession({ githubUserId: "gh-1" });
    client.createUserChannel.mockResolvedValue({
      id: "b1",
      kind: "telegram",
    });
    const res = await operateChannelsCreateRoute(
      postJson({
        agentId: 7,
        credential: "secret-token",
        label: "My Channel",
        miniAppUrl: "",
        miniAppLabel: " Portfolio ",
        commandEndpoint: "https://api.world.inc/commands/",
        commands: ["/B", "p"],
      }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      channel: { id: "b1", kind: "telegram" },
    });
    // Shape only: values are forwarded untouched (blank URL → null) and the
    // manager canonicalises trailing slashes, case and leading slashes.
    expect(client.createUserChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "gh-1",
        agentId: 7,
        kind: "telegram",
        credential: "secret-token",
        label: "My Channel",
        miniAppUrl: null,
        miniAppLabel: "Portfolio",
        commandEndpoint: "https://api.world.inc/commands/",
        commands: ["/B", "p"],
      }),
    );
  });

  it("omits command config the body did not mention", async () => {
    setSession({ githubUserId: "gh-1" });
    client.createUserChannel.mockResolvedValue({ id: "b1" });
    await operateChannelsCreateRoute(
      postJson({
        agentId: 7,
        credential: "secret-token",
      }),
    );
    const input = client.createUserChannel.mock.calls[0][0];
    expect(input).not.toHaveProperty("miniAppUrl");
    expect(input).not.toHaveProperty("miniAppLabel");
    expect(input).not.toHaveProperty("commandEndpoint");
    expect(input).not.toHaveProperty("commands");
  });

  it("400s a shape-invalid command config before calling the backend", async () => {
    setSession({ githubUserId: "gh-1" });
    const base = {
      agentId: 7,
      credential: "secret-token",
    };
    for (const bad of [
      { miniAppUrl: 42 },
      { commandEndpoint: ["x"] },
      { commands: "b, p" },
      { commands: ["b", 3] },
    ]) {
      const res = await operateChannelsCreateRoute(
        postJson({ ...base, ...bad }),
      );
      expect(res.status).toBe(400);
      const [field] = Object.keys(bad);
      await expect(res.json()).resolves.toEqual({
        error: `missing or invalid \`${field}\``,
      });
    }
    expect(client.createUserChannel).not.toHaveBeenCalled();
  });

  it("forwards the manager's 400 message instead of mirroring its rules", async () => {
    setSession({ githubUserId: "gh-1" });
    client.createUserChannel.mockRejectedValue(
      new BackendError(
        "create_user_channel",
        400,
        "create_user_channel failed (400)",
        JSON.stringify({ error: "command `start` is reserved" }),
      ),
    );
    const res = await operateChannelsCreateRoute(
      postJson({
        agentId: 7,
        credential: "secret-token",
        commandEndpoint: "https://api.world.inc/commands",
        commands: ["start"],
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "command `start` is reserved",
    });
  });

  it("never logs or echoes the credential value on failure paths", async () => {
    setSession({ githubUserId: "gh-1" });
    client.createUserChannel.mockRejectedValue(new Error("backend down"));
    const res = await operateChannelsCreateRoute(
      postJson({
        agentId: 7,
        credential: "top-secret",
      }),
    );
    const text = await res.text();
    expect(text).not.toContain("top-secret");
  });
});

describe("operateChannelsUpdateRoute", () => {
  it("forwards only the fields the body names, clearing blank URLs", async () => {
    setSession({ githubUserId: "gh-1" });
    client.updateUserChannel.mockResolvedValue({ id: "b1" });
    const res = await operateChannelsUpdateRoute(
      patchJson({
        channelId: "b1",
        agentId: 7,
        commandEndpoint: "",
        commands: [],
      }),
    );
    expect(res.status).toBe(200);
    const input = client.updateUserChannel.mock.calls[0][0];
    expect(input).toMatchObject({
      channelId: "b1",
      agentId: 7,
      commandEndpoint: null,
      commands: [],
    });
    expect(input).not.toHaveProperty("miniAppUrl");
  });

  it("passes the manager's webhook warning beside the saved channel, never inside it", async () => {
    setSession({ githubUserId: "gh-1" });
    client.updateUserChannel.mockResolvedValue({
      id: "b1",
      webhookWarning: "Telegram setWebhook failed (502 Bad Gateway)",
    });
    const res = await operateChannelsUpdateRoute(
      patchJson({ channelId: "b1", agentId: 7 }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      channel: { id: "b1" },
      webhookWarning: "Telegram setWebhook failed (502 Bad Gateway)",
    });

    client.updateUserChannel.mockResolvedValue({ id: "b1" });
    const clean = await operateChannelsUpdateRoute(
      patchJson({ channelId: "b1", agentId: 7 }),
    );
    await expect(clean.json()).resolves.toEqual({ channel: { id: "b1" } });
  });

  it("400s a shape-invalid command config and forwards a manager 400", async () => {
    setSession({ githubUserId: "gh-1" });
    let res = await operateChannelsUpdateRoute(
      patchJson({
        channelId: "b1",
        agentId: 7,
        miniAppUrl: { url: "x" },
      }),
    );
    expect(res.status).toBe(400);
    expect(client.updateUserChannel).not.toHaveBeenCalled();

    client.updateUserChannel.mockRejectedValue(
      new BackendError(
        "update_user_bot",
        400,
        "update_user_bot failed (400)",
        JSON.stringify({ error: "commands require a command_endpoint" }),
      ),
    );
    res = await operateChannelsUpdateRoute(
      patchJson({
        channelId: "b1",
        agentId: 7,
        commands: ["b"],
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "commands require a command_endpoint",
    });
  });
});

describe("operateChannelsCommandSecretRoute", () => {
  it("401s when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateChannelsCommandSecretRoute(commandSecretReq("b1"));
    expect(res.status).toBe(401);
    expect(client.revealUserChannelCommandSecret).not.toHaveBeenCalled();
  });

  it("reveals the secret through the session's builder id", async () => {
    setSession({ githubUserId: "gh-1" });
    client.revealUserChannelCommandSecret.mockResolvedValue({
      commandSecret: "deadbeef",
    });
    const res = await operateChannelsCommandSecretRoute(commandSecretReq("b1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ commandSecret: "deadbeef" });
    expect(client.revealUserChannelCommandSecret).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      channelId: "b1",
    });
  });

  it("forwards the manager's rejection of a channel the builder does not own", async () => {
    setSession({ githubUserId: "gh-1" });
    client.revealUserChannelCommandSecret.mockRejectedValue(
      new BackendError(
        "reveal_user_bot_command_secret",
        404,
        "reveal_user_bot_command_secret failed (404)",
        JSON.stringify({ error: "channel not found" }),
      ),
    );
    const res = await operateChannelsCommandSecretRoute(commandSecretReq("b9"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "channel not found" });
  });
});

describe("operateChannelsWebhookRoute", () => {
  it("401s when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateChannelsWebhookRoute(webhookReq("b1"));
    expect(res.status).toBe(401);
    expect(client.checkUserChannelWebhook).not.toHaveBeenCalled();
  });

  it("checks the webhook through the session's builder id", async () => {
    setSession({ githubUserId: "gh-1" });
    const webhook = {
      urlMatches: false,
      pendingUpdateCount: 3,
      lastErrorMessage: null,
      reasserted: true,
      warning: null,
    };
    client.checkUserChannelWebhook.mockResolvedValue(webhook);
    const res = await operateChannelsWebhookRoute(webhookReq("b1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ webhook });
    expect(client.checkUserChannelWebhook).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      channelId: "b1",
    });
  });

  it("forwards the manager's rejection of a channel the builder does not own", async () => {
    setSession({ githubUserId: "gh-1" });
    client.checkUserChannelWebhook.mockRejectedValue(
      new BackendError(
        "check_user_bot_webhook",
        404,
        "check_user_bot_webhook failed (404)",
        JSON.stringify({ error: "channel registration not found" }),
      ),
    );
    const res = await operateChannelsWebhookRoute(webhookReq("b9"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "channel registration not found",
    });
  });
});

describe("operateChannelsDeleteRoute", () => {
  it("401s delete when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateChannelsDeleteRoute(deleteReq("?channelId=b1"));
    expect(res.status).toBe(401);
    expect(client.deleteUserChannel).not.toHaveBeenCalled();
  });

  it("400s a delete missing channelId", async () => {
    setSession({ githubUserId: "gh-1" });
    const res = await operateChannelsDeleteRoute(deleteReq(""));
    expect(res.status).toBe(400);
    expect(client.deleteUserChannel).not.toHaveBeenCalled();
  });

  it("deletes a channel for an owned source", async () => {
    setSession({ githubUserId: "gh-1" });
    client.deleteUserChannel.mockResolvedValue(undefined);
    const res = await operateChannelsDeleteRoute(deleteReq("?channelId=b1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(client.deleteUserChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "gh-1",
        channelId: "b1",
      }),
    );
  });
});

const operateReq = (name: string, qs = "") =>
  new Request(`http://localhost:3000/api/build/operate/${name}${qs}`);

const PROJECT = {
  project: { id: 42, repositoryLink: "o/world" },
  platform: "community",
};

function payments(events: unknown[] = []) {
  return {
    available: true,
    scope: "recipient_bucket",
    summary: {
      accruedCredits: 0,
      accruedUsd: 0,
      settledCredits: 0,
      settledUsd: 0,
      outstandingCredits: 0,
      outstandingUsd: 0,
      pricedCalls: 0,
      settlements: 0,
    },
    resources: [],
    buckets: [],
    events,
  };
}

const settlement = {
  id: "settle:1",
  kind: "settlement_confirmed",
  occurredAt: 1_700_000_000,
  agent: "solo",
  agentId: 78,
  tools: [],
  credits: 100,
  usd: 1,
  asset: "USDC",
  assetAmount: 1,
  recipient: "0xbeneficiary",
  paymentMethod: "coinbase",
  receiptId: "0xreceipt",
  chain: "eip155:84532",
  explorerUrl: "https://sepolia.basescan.org/tx/0xreceipt",
};

function statement(available: boolean, events: unknown[] = []) {
  return {
    scope: "owned_agents",
    projects: [],
    range: { fromDate: "2026-07-01", toDate: "2026-07-15" },
    available,
    summary: { grossRevenue: 0, platformFees: 0, serviceCharges: 0, net: 0 },
    revenue: [],
    charges: [],
    entries: [],
    payments: payments(events),
  };
}

/** A project-less agent's row, as the manager tags it. */
const soloTx = {
  id: "tx-1",
  agent: "solo",
  agentId: 78,
  createdAt: 1_700_000_100,
  projectId: null,
  platform: null,
};

describe("operate reads are one account result", () => {
  beforeEach(() => setSession({ githubUserId: "gh-1" }));

  it("passes the health snapshot through, a project-less agent included", async () => {
    const snapshot = {
      scope: "owned_agents",
      projects: [],
      monitoring: {
        provider: "grafana_prometheus",
        status: "ok",
        windowSeconds: 900,
      },
      agents: [
        { agentId: 78, agent: "solo", slug: "alice/solo", projectId: null },
      ],
      dashboardLinks: [],
      platformMetrics: [],
    };
    client.getUserObservability.mockResolvedValue(snapshot);
    const res = await operateObservabilityRoute(operateReq("observability"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(snapshot);
    expect(client.getUserObservability).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      projectId: undefined,
      agentId: undefined,
    });
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("lets the manager narrow by project and agent", async () => {
    client.getUserObservability.mockResolvedValue({
      projects: [PROJECT],
      agents: [],
    });
    client.getUserPayments.mockResolvedValue(payments());
    await operateObservabilityRoute(
      operateReq("observability", "?projectId=42&agentId=77"),
    );
    const res = await operatePaymentsRoute(
      operateReq("payments", "?projectId=42"),
    );
    await expect(res.json()).resolves.toEqual({ payments: payments() });
    expect(client.getUserObservability).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      projectId: 42,
      agentId: 77,
    });
    expect(client.getUserPayments).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      projectId: 42,
      agentId: undefined,
    });
  });

  it("serves transactions from one page with the settlements on page one", async () => {
    client.listUserTransactions.mockResolvedValue({
      projects: [PROJECT],
      transactions: [soloTx],
      nextCursor: { createdAt: 1_700_000_100, id: "tx-1" },
    });
    client.getUserStatements.mockResolvedValue(statement(true, [settlement]));
    const res = await operateTransactionsRoute(
      operateReq("transactions", "?agentId=78&limit=20"),
    );
    const body = await res.json();
    expect(body.projects).toEqual([PROJECT]);
    expect(body.transactions.map((row: { id: string }) => row.id)).toEqual([
      "tx-1",
      "partner-payout:settle:1",
    ]);
    expect(body.transactions[0]).toMatchObject({
      kind: "agent_transaction",
      projectId: null,
    });
    expect(body.transactions[1]).toMatchObject({
      kind: "partner_payout",
      projectId: null,
    });
    expect(body.nextCursor).toEqual({ createdAt: 1_700_000_100, id: "tx-1" });
    expect(client.listUserTransactions).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      projectId: undefined,
      agentId: 78,
      limit: 20,
      status: undefined,
      cursor: undefined,
    });
  });

  it("skips the settlements past page one", async () => {
    client.listUserTransactions.mockResolvedValue({
      projects: [],
      transactions: [],
      nextCursor: null,
    });
    const cursor = encodeURIComponent(
      JSON.stringify({ createdAt: 1, id: "tx-0" }),
    );
    const res = await operateTransactionsRoute(
      operateReq("transactions", `?cursor=${cursor}`),
    );
    expect(res.status).toBe(200);
    expect(client.getUserStatements).not.toHaveBeenCalled();
  });

  it("serves usage with an empty statement, never an example", async () => {
    const usage = {
      scope: "owned_agents",
      projects: [],
      range: { fromDate: "2026-07-01", toDate: "2026-07-15", maxDays: 90 },
      daily: [
        {
          periodUtcDay: "2026-07-02",
          agent: "solo",
          agentId: 78,
          projectId: null,
          creditsUsed: 3,
        },
      ],
      breakdown: [],
    };
    client.getUserUsage.mockResolvedValue(usage);
    client.getUserStatements.mockResolvedValue(statement(true));
    const res = await operateUsageRoute(
      operateReq("usage", "?fromDate=2026-07-01"),
    );
    const body = await res.json();
    expect(body).not.toHaveProperty("example");
    expect(body).toMatchObject({
      projects: [],
      range: usage.range,
      daily: usage.daily,
    });
    expect(body.statement).toMatchObject({
      available: true,
      entries: [],
      revenue: [],
    });
    expect(client.getUserUsage).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      projectId: undefined,
      agentId: undefined,
      fromDate: "2026-07-01",
      toDate: undefined,
    });
  });

  it("keeps an unavailable statement unavailable", async () => {
    client.getUserUsage.mockResolvedValue({
      projects: [],
      range: null,
      daily: [],
      breakdown: [],
    });
    client.getUserStatements.mockResolvedValue(statement(false));
    const body = await (await operateUsageRoute(operateReq("usage"))).json();
    expect(body).not.toHaveProperty("example");
    expect(body.statement.available).toBe(false);
  });

  it("serves logs from one page", async () => {
    const page = {
      projects: [],
      logs: [
        {
          id: "log-1",
          agent: "solo",
          agentId: 78,
          projectId: null,
          platform: null,
        },
      ],
      nextCursor: null,
      invocationsAvailable: true,
    };
    client.listUserLogs.mockResolvedValue(page);
    const res = await operateLogsRoute(operateReq("logs", "?agentId=78"));
    await expect(res.json()).resolves.toEqual({
      projects: [],
      logs: page.logs,
      nextCursor: null,
    });
    expect(client.listUserLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "gh-1",
        agentId: 78,
        limit: 100,
      }),
    );
  });

  it("lists model keys with the agents a key can fund", async () => {
    const agents = [
      { id: 78, slug: "alice/solo", label: "Solo", projectId: null },
    ];
    client.listBuilderModelKeys.mockResolvedValue({ keys: [], agents });
    const res = await operateModelKeysRoute(operateReq("model-keys"));
    await expect(res.json()).resolves.toEqual({ keys: [], agents });
    expect(client.listBuilderModelKeys).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      platform: "community",
    });
  });
});

describe("operateAgentDetailRoute", () => {
  beforeEach(() => setSession({ githubUserId: "gh-1" }));

  const detail = (windowSeconds = 86400) => ({
    project: null,
    platform: null,
    windowSeconds,
    agent: { agentId: 78, name: "solo", slug: "alice/solo" },
  });

  it("requires a valid agent id", async () => {
    const res = await operateAgentDetailRoute(
      operateReq("observability/detail", "?agentId=nope"),
    );
    expect(res.status).toBe(400);
    expect(client.getBuilderAgentDetail).not.toHaveBeenCalled();
  });

  it("reads a project-less agent through agent-keyed reads", async () => {
    client.getBuilderAgentDetail.mockResolvedValue(detail());
    client.getUserObservability.mockResolvedValue({
      agents: [
        { agentId: 77, agent: "other" },
        { agentId: 78, agent: "solo", projectId: null },
      ],
    });
    client.listUserTransactions.mockResolvedValue({
      projects: [],
      transactions: [soloTx],
      nextCursor: null,
    });
    client.listUserLogs.mockResolvedValue({
      projects: [],
      logs: [],
      nextCursor: null,
    });
    const res = await operateAgentDetailRoute(
      operateReq("observability/detail", "?agentId=78"),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      detail: detail(),
      health: { agentId: 78, agent: "solo", projectId: null },
      transactions: [soloTx],
      logs: [],
      deployments: [],
    });
    expect(client.getUserObservability).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      agentId: 78,
    });
    expect(client.listUserTransactions).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      agentId: 78,
      limit: 4,
    });
    expect(client.listUserLogs).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      agentId: 78,
      limit: 4,
    });
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("refuses an older manager response for a requested seven-day window", async () => {
    client.getBuilderAgentDetail.mockResolvedValue(detail(86400));
    client.getUserObservability.mockResolvedValue({ agents: [] });
    client.listUserTransactions.mockResolvedValue({ transactions: [] });
    client.listUserLogs.mockResolvedValue({ logs: [] });
    const res = await operateAgentDetailRoute(
      operateReq("observability/detail", "?agentId=78&window=7d"),
    );
    expect(res.status).toBe(503);
  });

  it("rejects unsupported activity ranges before contacting the manager", async () => {
    const res = await operateAgentDetailRoute(
      operateReq("observability/detail", "?agentId=78&window=90d"),
    );
    expect(res.status).toBe(400);
    expect(client.getBuilderAgentDetail).not.toHaveBeenCalled();
  });
});
