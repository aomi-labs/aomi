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
  operateObservabilityRoute,
  operatePaymentsRoute,
  operateTransactionsRoute,
  operateUsageRoute,
} from "./routes";
import { getGitHubSession } from "./harness";

const client = {
  listUserProjects: vi.fn(),
  listUserProjectChannels: vi.fn(),
  createUserProjectChannel: vi.fn(),
  deleteUserProjectChannel: vi.fn(),
  listUserChannels: vi.fn(),
  createUserChannel: vi.fn(),
  updateUserChannel: vi.fn(),
  revealUserChannelCommandSecret: vi.fn(),
  checkUserChannelWebhook: vi.fn(),
  deleteUserChannel: vi.fn(),
  getUserProjectUsage: vi.fn(),
  getUserProjectStatement: vi.fn(),
  getUserObservability: vi.fn(),
  getUserPayments: vi.fn(),
  getUserProjectObservability: vi.fn(),
  getBuilderAgentDetail: vi.fn(),
  listUserProjectTransactions: vi.fn(),
  listUserProjectLogs: vi.fn(),
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
  client.listUserProjects.mockReset();
  client.listUserProjectChannels.mockReset();
  client.createUserProjectChannel.mockReset();
  client.deleteUserProjectChannel.mockReset();
  client.listUserChannels.mockReset();
  client.createUserChannel.mockReset();
  client.updateUserChannel.mockReset();
  client.revealUserChannelCommandSecret.mockReset();
  client.deleteUserChannel.mockReset();
  client.getUserProjectUsage.mockReset();
  client.getUserProjectStatement.mockReset();
  client.getUserObservability.mockReset();
  client.getUserPayments.mockReset();
  client.listUserTransactions.mockReset();
  client.getUserStatements.mockReset();
  client.getUserUsage.mockReset();
  client.listUserLogs.mockReset();
  client.getUserProjectObservability.mockReset();
  client.getBuilderAgentDetail.mockReset();
  client.listUserProjectTransactions.mockReset();
  client.listUserProjectLogs.mockReset();
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
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("lists builder-wide channels with agents from every bound platform", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      {
        id: 42,
        repositoryLink: "o/world-markets",
        platformName: "world-markets",
        agents: [{ id: 77, name: "world-markets" }],
      },
    ]);
    client.listUserChannels.mockResolvedValue([
      { id: "b1", platformUsername: "mybot" },
    ]);
    const res = await operateChannelsRoute(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      projects: [
        {
          platformName: "world-markets",
          agents: [{ id: 77, name: "world-markets" }],
        },
      ],
      channels: [{ id: "b1", platformUsername: "mybot" }],
    });
    expect(client.listUserProjects).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      platform: undefined,
    });
    expect(client.listUserChannels).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "gh-1",
      }),
    );
  });

  it("does not fan out over every owned source", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 1, agents: [] },
      { id: 2, agents: [] },
    ]);
    client.listUserChannels.mockResolvedValue([
      { id: "b1", platformUsername: "one" },
    ]);
    const res = await operateChannelsRoute(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels).toHaveLength(1);
    expect(client.listUserChannels).toHaveBeenCalledTimes(1);
  });

  it("logs an owned-source Rust 5xx without creating a BFF Issue", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockRejectedValue(
      new BackendError(
        "list_user_sources",
        503,
        "failed",
        "private backend body",
      ),
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

  it("rejects a create for agents the user does not own", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
    const res = await operateChannelsCreateRoute(
      postJson({
        agentId: 1,
        credential: "t",
      }),
    );
    expect(res.status).toBe(403);
    expect(client.createUserChannel).not.toHaveBeenCalled();
  });

  it("400s an invalid body before calling the backend", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
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
    client.listUserProjects.mockResolvedValue([
      { id: 42, agents: [{ id: 7 }] },
    ]);
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
    client.listUserProjects.mockResolvedValue([
      { id: 42, agents: [{ id: 7 }] },
    ]);
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
    client.listUserProjects.mockResolvedValue([
      { id: 42, agents: [{ id: 7 }] },
    ]);
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
    client.listUserProjects.mockResolvedValue([
      { id: 42, agents: [{ id: 7 }] },
    ]);
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
    client.listUserProjects.mockResolvedValue([
      { id: 42, agents: [{ id: 7 }] },
    ]);
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
  const owned = () =>
    client.listUserProjects.mockResolvedValue([
      { id: 42, agents: [{ id: 7 }] },
    ]);

  it("forwards only the fields the body names, clearing blank URLs", async () => {
    setSession({ githubUserId: "gh-1" });
    owned();
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
    owned();
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
    owned();
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
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
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
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
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
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
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
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
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
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
    const res = await operateChannelsDeleteRoute(deleteReq(""));
    expect(res.status).toBe(400);
    expect(client.deleteUserChannel).not.toHaveBeenCalled();
  });

  it("deletes a channel for an owned source", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, agents: [] }]);
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

function usageReq(qs = "") {
  return new Request(`http://localhost:3000/api/build/operate/usage${qs}`);
}
function observabilityReq() {
  return new Request("http://localhost:3000/api/build/operate/observability");
}
function transactionsReq(qs = "") {
  return new Request(
    `http://localhost:3000/api/build/operate/transactions${qs}`,
  );
}
function logsReq(qs = "") {
  return new Request(`http://localhost:3000/api/build/operate/logs${qs}`);
}
function agentDetailReq(qs = "?agentId=77") {
  return new Request(
    `http://localhost:3000/api/build/operate/observability/detail${qs}`,
  );
}

const oneSource = (platformName = "community") =>
  client.listUserProjects.mockResolvedValue([
    { id: 900, repositoryLink: "o/r", platformName, agents: [] },
  ]);

// The route consumes the deploy client's already-camelCased results.
const emptyUsage = {
  project: { id: 900 },
  platform: "community",
  range: { fromDate: "2026-07-01", toDate: "2026-07-15", maxDays: 31 },
  daily: [],
  breakdown: [],
};

function emptyPayments() {
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
    events: [],
  };
}

function sharedSettlementPayments(agentId: number | null = null) {
  return {
    ...emptyPayments(),
    summary: {
      ...emptyPayments().summary,
      settledCredits: 100,
      settledUsd: 1,
      settlements: 1,
    },
    buckets: [
      {
        id: "shared-bucket",
        recipient: "0xbeneficiary",
        outstandingCredits: 0,
        outstandingUsd: 0,
      },
    ],
    events: [
      {
        id: "settle:shared",
        kind: "settlement_confirmed",
        occurredAt: 1_700_000_000,
        agent: agentId == null ? null : `package-${agentId}`,
        agentId,
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
      },
    ],
  };
}

describe("operateUsageRoute statement fallback", () => {
  it("uses the canonical Project platform for ownership and usage reads", async () => {
    vi.stubEnv("BUILD_DEFAULT_PLATFORM", "community");
    setSession({ githubUserId: "gh-1" });
    oneSource("somm.finance");
    client.getUserProjectUsage.mockResolvedValue({
      ...emptyUsage,
      platform: "somm.finance",
    });
    client.getUserProjectStatement.mockRejectedValue(new Error("404"));

    const res = await operateUsageRoute(
      usageReq("?projectId=900&platform=somm.finance"),
    );

    expect(res.status).toBe(200);
    expect(client.listUserProjects).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      platform: undefined,
    });
    // Per-project reads carry no platform: the backend derives the
    // project's bound platform from the row.
    expect(client.getUserProjectUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 900,
        githubUserId: "gh-1",
      }),
    );
    expect(client.getUserProjectUsage).toHaveBeenCalledWith(
      expect.not.objectContaining({ platform: expect.anything() }),
    );
    expect(client.getUserProjectStatement).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 900,
        githubUserId: "gh-1",
      }),
    );
  });

  it("ignores a URL platform once a canonical Project ID exists", async () => {
    vi.stubEnv("BUILD_DEFAULT_PLATFORM", "community");
    setSession({ githubUserId: "gh-1" });
    oneSource("known.partner");
    client.getUserProjectUsage.mockResolvedValue(emptyUsage);
    client.getUserProjectStatement.mockRejectedValue(new Error("404"));

    const res = await operateUsageRoute(
      usageReq("?projectId=900&platform=known.partner"),
    );

    expect(res.status).toBe(200);
    expect(client.listUserProjects).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      platform: undefined,
    });
  });

  it("serves the example statement (example: true) when the manager has none", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserProjectUsage.mockResolvedValue(emptyUsage);
    // No statement endpoint yet → the client throws → source drops out.
    client.getUserProjectStatement.mockRejectedValue(new Error("404"));

    const res = await operateUsageRoute(usageReq("?projectId=900"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.example).toBe(true);
    // The folded example summary — the same numbers the harness renders.
    expect(body.statement.summary.grossRevenue).toBeCloseTo(183.25, 2);
    expect(body.statement.summary.net).toBeCloseTo(113.02, 2);
    expect(body.statement.entries.length).toBeGreaterThan(0);
  });

  it("drops a statement the backend reports as unavailable", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserProjectUsage.mockResolvedValue(emptyUsage);
    client.getUserProjectStatement.mockResolvedValue({
      project: { id: 900 },
      platform: "community",
      range: { fromDate: "2026-07-01", toDate: "2026-07-15" },
      available: false,
      summary: { grossRevenue: 0, platformFees: 0, serviceCharges: 0, net: 0 },
      revenue: [],
      charges: [],
      entries: [],
    });

    const res = await operateUsageRoute(usageReq("?projectId=900"));
    const body = await res.json();
    expect(body.example).toBe(true); // fell back to example
  });

  it("uses the real statement (no example flag) when the manager returns one", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserProjectUsage.mockResolvedValue(emptyUsage);
    client.getUserProjectStatement.mockResolvedValue({
      project: { id: 900 },
      platform: "community",
      range: { fromDate: "2026-07-01", toDate: "2026-07-15" },
      available: true,
      summary: {
        grossRevenue: 9,
        platformFees: 0.9,
        serviceCharges: 2,
        net: 6.1,
      },
      revenue: [
        {
          subject: "tool_invocation",
          agent: "real-channel",
          agentId: 1,
          events: 3,
          gross: 9,
          platformFee: 0.9,
          net: 8.1,
        },
      ],
      charges: [],
      entries: [],
      payments: emptyPayments(),
    });

    const res = await operateUsageRoute(usageReq("?projectId=900"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.example).toBeUndefined();
    expect(body.statement.summary.net).toBeCloseTo(6.1, 2);
    expect(body.statement.revenue[0].agent).toBe("real-channel");
  });

  it("deduplicates a recipient-bucket settlement shared by two projects", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 900, repositoryLink: "o/one", agents: [] },
      { id: 901, repositoryLink: "o/two", agents: [] },
    ]);
    client.getUserUsage.mockResolvedValue(
      [900, 901].map((id) => ({ ...emptyUsage, project: { id } })),
    );
    const payment = sharedSettlementPayments();
    payment.buckets[0].outstandingCredits = 25;
    client.getUserStatements.mockResolvedValue(
      [900, 901].map((id) => ({
        project: { id },
        platform: "community",
        range: { fromDate: "2026-07-01", toDate: "2026-07-15" },
        available: true,
        summary: {
          grossRevenue: 0,
          platformFees: 0,
          serviceCharges: 0,
          net: 0,
        },
        revenue: [],
        charges: [],
        entries: [],
        payments: payment,
      })),
    );

    const res = await operateUsageRoute(usageReq());
    const body = await res.json();

    expect(body.statement.payments.summary.settledCredits).toBe(100);
    expect(body.statement.payments.summary.settlements).toBe(1);
    expect(body.statement.payments.summary.outstandingCredits).toBe(25);
    expect(body.statement.payments.summary.outstandingUsd).toBe(0.25);
    expect(body.statement.payments.events).toHaveLength(1);
    expect(body.statement.payments.buckets).toHaveLength(1);
  });
});

describe("operateObservabilityRoute live data", () => {
  it("keeps a partial live card partial instead of grafting example trends", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        scope: "owned_agents",
        monitoring: {
          provider: "grafana_prometheus",
          status: "ok",
          windowSeconds: 900,
        },
        agents: [
          {
            id: 1,
            agent: "real-channel",
            active: true,
            loaded: true,
            status: "healthy",
            // Live window metrics, but no 24h trend fields yet.
            metrics: {
              provider: "grafana_prometheus",
              windowSeconds: 900,
              available: true,
              errorRate: 0.5,
              p95LatencyMs: 1234,
            },
          },
        ],
        dashboardLinks: [],
        platformMetrics: [],
      },
    ]);

    const res = await operateObservabilityRoute(observabilityReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.example).toBeUndefined();
    const card = body.agents.find(
      (a: { agent: string }) => a.agent === "real-channel",
    );
    expect(card.metrics.errorRate).toBe(0.5); // real value preserved
    expect(card.metrics.p95LatencyMs).toBe(1234); // real value preserved
    expect(card.metrics.chats24h).toBeUndefined();
    expect(card.metrics.chatsHourly).toBeUndefined();
  });

  it("returns an empty agent list when the account has no live agents", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        scope: "owned_agents",
        monitoring: null,
        agents: [],
        dashboardLinks: [],
        platformMetrics: [],
      },
    ]);

    const res = await operateObservabilityRoute(observabilityReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.example).toBeUndefined();
    expect(body.agents).toEqual([]);
    expect(body.monitoring.status).toBe("unconfigured");
  });

  it("serves the whole account from one batch read when the manager has it", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        scope: "owned_agents",
        monitoring: {
          provider: "grafana_prometheus",
          status: "ok",
          windowSeconds: 900,
        },
        agents: [
          {
            id: 1,
            agent: "real-channel",
            active: true,
            loaded: true,
            status: "healthy",
            metrics: null,
          },
        ],
        payments: emptyPayments(),
        dashboardLinks: [],
        platformMetrics: [],
      },
      {
        // A partner-bound source the per-source fan-out could never read
        // under the default platform. The batch still covers it — the read
        // stays account-wide — but this page is scoped to `community`, so it
        // must not render here. Its own platform's page shows it.
        project: { id: 1620 },
        platform: "somm.finance",
        scope: "owned_agents",
        monitoring: {
          provider: "grafana_prometheus",
          status: "ok",
          windowSeconds: 900,
        },
        agents: [
          {
            id: 2,
            agent: "somm-agent",
            active: true,
            loaded: true,
            status: "healthy",
            metrics: null,
          },
        ],
        payments: emptyPayments(),
        dashboardLinks: [],
        platformMetrics: [],
      },
    ]);

    const first = await operateObservabilityRoute(observabilityReq());
    const second = await operateObservabilityRoute(observabilityReq());
    const body = await first.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // One account-wide read per request; no per-source fan-out.
    expect(client.getUserObservability).toHaveBeenCalledTimes(2);
    expect(client.getUserObservability).toHaveBeenCalledWith(
      expect.objectContaining({ githubUserId: "gh-1" }),
    );
    expect(client.getUserProjectObservability).not.toHaveBeenCalled();
    expect(body.degraded).toBeUndefined();
    expect(body.payments).toBeUndefined();
    expect(
      body.agents.map((packageName: { agent: string }) => packageName.agent),
    ).toEqual(["real-channel"]);
    expect(body.monitoring.status).toBe("ok");
  });

  /** The read is account-wide, the page is not. Observability must show the
   *  same projects `/projects` lists for the selected platform — a card for a
   *  project the console cannot even open reads as someone else's account. */
  it("scopes the account-wide batch to the selected platform's projects", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockImplementation(async ({ platform }) =>
      platform === "somm.finance"
        ? [
            {
              id: 1620,
              repositoryLink: "o/somm",
              platformName: "somm.finance",
              agents: [],
            },
          ]
        : [
            {
              id: 900,
              repositoryLink: "o/r",
              platformName: "community",
              agents: [],
            },
          ],
    );
    const snapshot = (id: number, platform: string, agent: string) => ({
      project: { id },
      platform,
      scope: "owned_agents",
      monitoring: {
        provider: "grafana_prometheus",
        status: "ok",
        windowSeconds: 900,
      },
      agents: [
        {
          id: id,
          agent,
          active: true,
          loaded: true,
          status: "healthy",
          metrics: null,
        },
      ],
      payments: emptyPayments(),
      dashboardLinks: [],
      platformMetrics: [],
    });
    client.getUserObservability.mockResolvedValue([
      snapshot(900, "community", "real-channel"),
      snapshot(1620, "somm.finance", "somm-agent"),
    ]);

    const res = await operateObservabilityRoute(
      new Request(
        "http://localhost:3000/api/build/operate/observability?platform=somm.finance",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // Still one account-wide read — only the response is narrowed.
    expect(client.getUserObservability).toHaveBeenCalledWith(
      expect.objectContaining({ githubUserId: "gh-1" }),
    );
    expect(
      body.agents.map((packageName: { agent: string }) => packageName.agent),
    ).toEqual(["somm-agent"]);
    expect(body.projects.map((project: { id: number }) => project.id)).toEqual([
      1620,
    ]);
  });

  it("does not restore the per-source fan-out when the batch route is missing", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockRejectedValue(
      new BackendError("get_user_observability", 404, "not found"),
    );
    const res = await operateObservabilityRoute(observabilityReq());

    expect(res.status).toBe(404);
    expect(client.getUserObservability).toHaveBeenCalled();
    expect(client.getUserProjectObservability).not.toHaveBeenCalled();
  });

  it("surfaces non-404 batch failures instead of silently fanning out", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockRejectedValue(
      new BackendError("get_user_observability", 500, "manager exploded"),
    );

    const res = await operateObservabilityRoute(observabilityReq());

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(client.getUserProjectObservability).not.toHaveBeenCalled();
  });
});

describe("operatePaymentsRoute", () => {
  it("loads the payment ledger independently from the main observability snapshot", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserPayments.mockResolvedValue([
      { project: { id: 900 }, payments: emptyPayments() },
    ]);

    const res = await operatePaymentsRoute(
      new Request("http://localhost:3000/api/build/operate/payments"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      payments: { scope: "recipient_bucket" },
    });
    expect(client.getUserPayments).toHaveBeenCalledWith(
      expect.objectContaining({ githubUserId: "gh-1", projectId: undefined }),
    );
    expect(client.getUserObservability).not.toHaveBeenCalled();
  });
});

describe("operateAgentDetailRoute", () => {
  it("requires a valid agent id", async () => {
    setSession({ githubUserId: "gh-1" });
    const res = await operateAgentDetailRoute(agentDetailReq("?agentId=nope"));
    expect(res.status).toBe(400);
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("refuses an older manager response for a requested seven-day window", async () => {
    setSession({ githubUserId: "gh-1" });
    client.getBuilderAgentDetail.mockResolvedValue({
      project: { id: 900 },
      windowSeconds: 86400,
    });
    const response = await operateAgentDetailRoute(
      new Request(
        "http://localhost:3000/api/build/operate/observability/detail?agentId=77&window=7d",
      ),
    );
    expect(response.status).toBe(503);
    expect(client.getBuilderAgentDetail).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      agentId: 77,
      window: "7d",
    });
    expect(client.getUserProjectObservability).not.toHaveBeenCalled();
  });

  it("rejects unsupported activity ranges before contacting the manager", async () => {
    setSession({ githubUserId: "gh-1" });
    const response = await operateAgentDetailRoute(
      new Request(
        "http://localhost:3000/api/build/operate/observability/detail?agentId=77&window=365d",
      ),
    );
    expect(response.status).toBe(400);
    expect(client.getBuilderAgentDetail).not.toHaveBeenCalled();
  });

  it.each(["1h", "24h", "7d", "30d"] as const)(
    "derives the owned agent and forwards the %s range",
    async (window) => {
      setSession({ githubUserId: "gh-1" });
      oneSource("world-markets");
      client.getBuilderAgentDetail.mockResolvedValue({
        project: { id: 900 },
        windowSeconds: {
          "1h": 3600,
          "24h": 86400,
          "7d": 604800,
          "30d": 2592000,
        }[window],
        platform: "community",
        agent: { agentId: 77, name: "demo" },
      });
      client.getUserProjectObservability.mockResolvedValue({
        agents: [{ agentId: 77, agent: "demo", status: "healthy" }],
      });
      client.listUserProjectTransactions.mockResolvedValue({
        project: { id: 900 },
        platform: "community",
        transactions: [
          { id: "tx-match", agentId: 77 },
          { id: "tx-other", agentId: 88 },
        ],
        nextCursor: null,
      });
      client.listUserProjectLogs.mockResolvedValue({
        project: { id: 900 },
        platform: "community",
        logs: [
          { id: "log-match", agentId: 77 },
          { id: "log-other", agentId: 88 },
        ],
        nextCursor: null,
      });

      const res = await operateAgentDetailRoute(
        agentDetailReq(`?agentId=77&window=${window}`),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.detail.agent).toEqual({ agentId: 77, name: "demo" });
      expect(body.health).toEqual({
        agentId: 77,
        agent: "demo",
        status: "healthy",
      });
      expect(body.transactions).toEqual([{ id: "tx-match", agentId: 77 }]);
      expect(body.logs).toEqual([{ id: "log-match", agentId: 77 }]);
      expect(body.deployments).toEqual([]);
      expect(client.getBuilderAgentDetail).toHaveBeenCalledWith({
        githubUserId: "gh-1",
        agentId: 77,
        window,
      });
      expect(client.listUserProjects).not.toHaveBeenCalled();
    },
  );
});

describe("account-wide batch reads", () => {
  beforeEach(() => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 900, repositoryLink: "o/one", agents: [] },
      { id: 1620, repositoryLink: "partner/package", agents: [] },
    ]);
  });

  it("serves transactions from one merged page and maps rows to projects", async () => {
    client.listUserTransactions.mockResolvedValue({
      projects: [
        {
          project: { id: 900, repositoryLink: "o/one" },
          platform: "community",
        },
        {
          project: { id: 1620, repositoryLink: "partner/package" },
          platform: "somm.finance",
        },
      ],
      transactions: [
        {
          id: "tx:b",
          createdAt: 1_700_000_100,
          projectId: 1620,
          platform: "somm.finance",
        },
        {
          id: "tx:a",
          createdAt: 1_700_000_000,
          projectId: 900,
          platform: "community",
        },
      ],
      nextCursor: { createdAt: 1_700_000_000, id: "tx:a" },
    });
    client.getUserStatements.mockResolvedValue([]);

    const res = await operateTransactionsRoute(transactionsReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(client.listUserProjectTransactions).not.toHaveBeenCalled();
    expect(client.getUserProjectStatement).not.toHaveBeenCalled();
    expect(body.transactions.map((tx: { id: string }) => tx.id)).toEqual([
      "tx:b",
      "tx:a",
    ]);
    // The partner-bound row resolves to its own source and platform.
    expect(body.transactions[0].project.id).toBe(1620);
    expect(body.transactions[0].platform).toBe("somm.finance");
    // Pagination continues through the batch's global cursor.
    expect(body.nextCursor).toEqual({ createdAt: 1_700_000_000, id: "tx:a" });
  });

  /** The merged page spans every platform the account owns; the page it feeds
   *  is scoped to one. Rows for a project this platform does not list are
   *  dropped, and the global cursor still carries the reader forward. */
  it("scopes the merged transactions page to the selected platform", async () => {
    client.listUserProjects.mockResolvedValue([
      {
        id: 900,
        repositoryLink: "o/one",
        platformName: "community",
        agents: [],
      },
    ]);
    client.listUserTransactions.mockResolvedValue({
      projects: [
        {
          project: { id: 900, repositoryLink: "o/one" },
          platform: "community",
        },
        {
          project: { id: 1620, repositoryLink: "partner/package" },
          platform: "somm.finance",
        },
      ],
      transactions: [
        {
          id: "tx:b",
          createdAt: 1_700_000_100,
          projectId: 1620,
          platform: "somm.finance",
        },
        {
          id: "tx:a",
          createdAt: 1_700_000_000,
          projectId: 900,
          platform: "community",
        },
      ],
      nextCursor: { createdAt: 1_700_000_000, id: "tx:a" },
    });
    client.getUserStatements.mockResolvedValue([]);

    const body = await (
      await operateTransactionsRoute(transactionsReq())
    ).json();

    expect(body.transactions.map((tx: { id: string }) => tx.id)).toEqual([
      "tx:a",
    ]);
    expect(body.projects.map((project: { id: number }) => project.id)).toEqual([
      900,
    ]);
    expect(body.nextCursor).toEqual({ createdAt: 1_700_000_000, id: "tx:a" });
  });

  it("passes the batch cursor through and skips statements past page one", async () => {
    client.listUserTransactions.mockResolvedValue({
      projects: [],
      transactions: [],
      nextCursor: null,
    });

    const cursor = encodeURIComponent(
      JSON.stringify({ createdAt: 1_700_000_000, id: "tx:a" }),
    );
    const res = await operateTransactionsRoute(
      transactionsReq(`?cursor=${cursor}`),
    );

    expect(res.status).toBe(200);
    expect(client.listUserTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { createdAt: 1_700_000_000, id: "tx:a" },
      }),
    );
    expect(client.getUserStatements).not.toHaveBeenCalled();
  });

  it("serves usage and the statement from the batch sweeps", async () => {
    client.getUserUsage.mockResolvedValue([
      {
        ...emptyUsage,
        daily: [
          {
            periodUtcDay: "2026-07-15",
            agent: "package",
            agentId: 1,
            inputTokens: 10,
            outputTokens: 5,
            creditsUsed: 2,
          },
        ],
      },
    ]);
    client.getUserStatements.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        range: { fromDate: "2026-07-01", toDate: "2026-07-15" },
        available: true,
        summary: {
          grossRevenue: 12,
          platformFees: 2,
          serviceCharges: 1,
          net: 9,
        },
        revenue: [],
        charges: [],
        entries: [],
        payments: emptyPayments(),
      },
    ]);

    const body = await (await operateUsageRoute(usageReq())).json();

    expect(client.getUserProjectUsage).not.toHaveBeenCalled();
    expect(client.getUserProjectStatement).not.toHaveBeenCalled();
    expect(body.example).toBeUndefined();
    expect(body.daily).toHaveLength(1);
    expect(body.statement.summary.grossRevenue).toBe(12);
  });

  it("serves logs pre-merged with the batch cursor", async () => {
    client.listUserLogs.mockResolvedValue({
      projects: [
        {
          project: { id: 900, repositoryLink: "o/one" },
          platform: "community",
        },
      ],
      logs: [
        {
          id: "log:1",
          eventType: "transaction",
          occurredAt: 1_700_000_000,
          details: {},
          projectId: 900,
          platform: "community",
        },
        {
          id: "settle:shared",
          eventType: "usage",
          occurredAt: 1_699_999_999,
          details: { source: "partner_settlement" },
          projectId: null,
          platform: null,
        },
      ],
      nextCursor: {
        occurredAt: 1_699_999_999,
        eventType: "usage",
        id: "settle:shared",
      },
      invocationsAvailable: true,
    });

    const body = await (await operateLogsRoute(logsReq())).json();

    expect(client.listUserProjectLogs).not.toHaveBeenCalled();
    expect(body.logs).toHaveLength(2);
    expect(body.logs[0].project.id).toBe(900);
    // A shared settlement belongs to the account, not one project.
    expect(body.logs[1].project).toBeNull();
    expect(body.nextCursor).toEqual({
      occurredAt: 1_699_999_999,
      eventType: "usage",
      id: "settle:shared",
    });
  });

  /** The merged stream spans every platform the account owns. Rows for a
   *  project this platform does not list are dropped; account-level rows
   *  (a shared partner settlement has no project) belong to every view. */
  it("scopes the merged log stream to the selected platform", async () => {
    client.listUserProjects.mockResolvedValue([
      {
        id: 900,
        repositoryLink: "o/one",
        platformName: "community",
        agents: [],
      },
    ]);
    client.listUserLogs.mockResolvedValue({
      projects: [
        {
          project: { id: 900, repositoryLink: "o/one" },
          platform: "community",
        },
        {
          project: { id: 1620, repositoryLink: "o/somm" },
          platform: "somm.finance",
        },
      ],
      logs: [
        {
          id: "log:mine",
          eventType: "transaction",
          occurredAt: 1_700_000_002,
          details: {},
          projectId: 900,
          platform: "community",
        },
        {
          id: "log:other-platform",
          eventType: "transaction",
          occurredAt: 1_700_000_001,
          details: {},
          projectId: 1620,
          platform: "somm.finance",
        },
        {
          id: "settle:shared",
          eventType: "usage",
          occurredAt: 1_700_000_000,
          details: { source: "partner_settlement" },
          projectId: null,
          platform: null,
        },
      ],
      nextCursor: null,
      invocationsAvailable: true,
    });

    const body = await (await operateLogsRoute(logsReq())).json();

    expect(body.logs.map((log: { id: string }) => log.id)).toEqual([
      "log:mine",
      "settle:shared",
    ]);
  });

  it("keeps a single-source view on the per-source read", async () => {
    client.listUserProjectTransactions.mockResolvedValue({
      project: { id: 900 },
      platform: "community",
      transactions: [],
      nextCursor: null,
    });
    client.getUserProjectStatement.mockResolvedValue({
      project: { id: 900 },
      platform: "community",
      payments: emptyPayments(),
    });

    const res = await operateTransactionsRoute(
      transactionsReq("?projectId=900"),
    );

    expect(res.status).toBe(200);
    expect(client.listUserTransactions).not.toHaveBeenCalled();
    expect(client.listUserProjectTransactions).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-404 batch failure instead of silently fanning out", async () => {
    client.listUserTransactions.mockRejectedValue(
      new BackendError("list_user_transactions", 502, "bad gateway"),
    );
    client.getUserStatements.mockResolvedValue([]);

    const res = await operateTransactionsRoute(transactionsReq());

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(client.listUserProjectTransactions).not.toHaveBeenCalled();
  });
});

/**
 * These assert the *shape of the request graph*, not the payload. Output
 * parity would survive a refactor that quietly put `listUserProjects` back on
 * the critical path, and that round trip is the whole cost this change
 * removed — so it needs a test that fails when it comes back.
 */
describe("account-wide reads do not waterfall behind listUserProjects", () => {
  /** A `listUserProjects` that never settles until the test releases it. */
  function pendingSources() {
    let release!: (projects: unknown[]) => void;
    const gate = new Promise<unknown[]>((resolve) => {
      release = resolve;
    });
    client.listUserProjects.mockReturnValue(gate);
    return { release };
  }

  it("starts the observability snapshot while the source list is still pending", async () => {
    setSession({ githubUserId: "gh-1" });
    const { release } = pendingSources();
    let snapshotStarted = false;
    client.getUserObservability.mockImplementation(async () => {
      snapshotStarted = true;
      return [];
    });

    const pending = operateObservabilityRoute(
      new Request("http://localhost:3000/api/build/operate/observability"),
    );
    // Yield past the microtasks the route needs to reach its manager call.
    // If the snapshot were sequenced after the source list, it could not have
    // started while that list is still unresolved.
    await vi.waitFor(() => expect(snapshotStarted).toBe(true));
    expect(client.getUserObservability).toHaveBeenCalledOnce();

    release([{ id: 42, repositoryLink: "o/r", agents: [] }]);
    const res = await pending;
    expect(res.status).toBe(200);
    // The dropdown still gets the full list — parallel, not dropped.
    await expect(res.json()).resolves.toMatchObject({
      projects: [{ id: 42 }],
    });
  });

  it("starts the merged logs page while the source list is still pending", async () => {
    setSession({ githubUserId: "gh-1" });
    const { release } = pendingSources();
    let pageStarted = false;
    client.listUserLogs.mockImplementation(async () => {
      pageStarted = true;
      return { projects: [], logs: [], nextCursor: null };
    });

    const pending = operateLogsRoute(
      new Request("http://localhost:3000/api/build/operate/logs"),
    );
    await vi.waitFor(() => expect(pageStarted).toBe(true));

    release([{ id: 42, repositoryLink: "o/r", agents: [] }]);
    expect((await pending).status).toBe(200);
  });

  it("starts the merged transactions page while the source list is still pending", async () => {
    setSession({ githubUserId: "gh-1" });
    const { release } = pendingSources();
    let pageStarted = false;
    client.listUserTransactions.mockImplementation(async () => {
      pageStarted = true;
      return { projects: [], transactions: [], nextCursor: null };
    });
    client.getUserStatements.mockResolvedValue([]);

    const pending = operateTransactionsRoute(
      new Request("http://localhost:3000/api/build/operate/transactions"),
    );
    await vi.waitFor(() => expect(pageStarted).toBe(true));
    expect(client.listUserTransactions).toHaveBeenCalledOnce();

    release([{ id: 42, repositoryLink: "o/r", agents: [] }]);
    const res = await pending;
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ projects: [{ id: 42 }] });
  });

  it("starts the usage sweep while the source list is still pending", async () => {
    setSession({ githubUserId: "gh-1" });
    const { release } = pendingSources();
    let sweepStarted = false;
    client.getUserUsage.mockImplementation(async () => {
      sweepStarted = true;
      return [];
    });
    client.getUserStatements.mockResolvedValue([]);

    const pending = operateUsageRoute(
      new Request("http://localhost:3000/api/build/operate/usage"),
    );
    await vi.waitFor(() => expect(sweepStarted).toBe(true));
    expect(client.getUserUsage).toHaveBeenCalledOnce();

    release([{ id: 42, repositoryLink: "o/r", agents: [] }]);
    const res = await pending;
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ projects: [{ id: 42 }] });
  });

  /** The ledger read is account-wide, so the source list is what scopes it to
   *  the selected platform. It must never be a waterfall in front of the
   *  ledger read — a regression there is a serial manager hop per poll. */
  it("reads the source list alongside, not ahead of, an unfiltered payments request", async () => {
    setSession({ githubUserId: "gh-1" });
    const { release } = pendingSources();
    let ledgerStarted = false;
    client.getUserPayments.mockImplementation(async () => {
      ledgerStarted = true;
      return [];
    });

    const pending = operatePaymentsRoute(
      new Request("http://localhost:3000/api/build/operate/payments"),
    );
    await vi.waitFor(() => expect(ledgerStarted).toBe(true));

    release([{ id: 42, repositoryLink: "o/r", agents: [] }]);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(client.getUserPayments).toHaveBeenCalledOnce();
  });

  /** A ledger row for a project on another platform must not surface here —
   *  the payment card sits on a page scoped to one platform. */
  it("scopes unfiltered payments to the selected platform's projects", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    const withResource = (agent: string) => ({
      ...emptyPayments(),
      resources: [{ agent, priced: true }],
    });
    client.getUserPayments.mockResolvedValue([
      { project: { id: 900 }, payments: withResource("real-channel") },
      { project: { id: 1620 }, payments: withResource("somm-agent") },
    ]);

    const res = await operatePaymentsRoute(
      new Request("http://localhost:3000/api/build/operate/payments"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(client.getUserPayments).toHaveBeenCalledOnce();
    expect(
      body.payments.resources.map((r: { agent: string }) => r.agent),
    ).toEqual(["real-channel"]);
  });

  /** …but a source-scoped request still must, because that is where
   *  `projectId` is proven to belong to the signed-in user. */
  it("still resolves the source list to authorize a scoped payments request", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 42, repositoryLink: "o/r", agents: [] },
    ]);
    client.getUserPayments.mockResolvedValue([]);

    const ok = await operatePaymentsRoute(
      new Request(
        "http://localhost:3000/api/build/operate/payments?projectId=42",
      ),
    );
    expect(ok.status).toBe(200);
    expect(client.listUserProjects).toHaveBeenCalled();

    const foreign = await operatePaymentsRoute(
      new Request(
        "http://localhost:3000/api/build/operate/payments?projectId=99",
      ),
    );
    expect(foreign.status).toBe(404);
  });
});
