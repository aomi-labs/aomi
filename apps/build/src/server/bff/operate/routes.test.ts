// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "@aomi-labs/deploy";

import {
  clearOperateCachesForTesting,
  operateAppDetailRoute,
  operateBotsRoute,
  operateBotsCommandSecretRoute,
  operateBotsCreateRoute,
  operateBotsDeleteRoute,
  operateBotsUpdateRoute,
  operateBotsWebhookRoute,
  operateLogsRoute,
  operateObservabilityRoute,
  operatePaymentsRoute,
  operateTransactionsRoute,
  operateUsageRoute,
} from "./routes";

const telemetry = vi.hoisted(() => ({
  capture: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@build/server/bff/failures", async () => {
  const { classifyFailure, identifyFailure } =
    await import("@aomi-labs/bff-observability");
  return {
    buildFailures: {
      handle: (input: Parameters<typeof identifyFailure>[0]) => {
        const decision = classifyFailure(identifyFailure(input));
        const eventContext = {
          ...decision.context,
          status: decision.responseStatus,
          ...(decision.upstream ? { upstream: decision.upstream } : {}),
          ...(decision.upstreamStatus !== undefined
            ? { upstreamStatus: decision.upstreamStatus }
            : {}),
        };
        if (decision.action === "issue") {
          telemetry.capture(decision.error, eventContext);
        } else if (decision.action === "log") {
          telemetry.log(eventContext);
        }
        return {
          ...decision,
          response: Response.json(
            { error: decision.responseError },
            { status: decision.responseStatus },
          ),
        };
      },
    },
  };
});

const client = {
  listUserProjects: vi.fn(),
  listUserProjectBots: vi.fn(),
  createUserProjectBot: vi.fn(),
  deleteUserProjectBot: vi.fn(),
  listUserBots: vi.fn(),
  createUserBot: vi.fn(),
  updateUserBot: vi.fn(),
  revealUserBotCommandSecret: vi.fn(),
  checkUserBotWebhook: vi.fn(),
  deleteUserBot: vi.fn(),
  getUserProjectUsage: vi.fn(),
  getUserProjectStatement: vi.fn(),
  getUserObservability: vi.fn(),
  getUserPayments: vi.fn(),
  getUserProjectObservability: vi.fn(),
  getBuilderApplicationDetail: vi.fn(),
  listUserProjectTransactions: vi.fn(),
  listUserProjectLogs: vi.fn(),
  listUserProjectDeployments: vi.fn(),
  listUserTransactions: vi.fn(),
  getUserStatements: vi.fn(),
  getUserUsage: vi.fn(),
  listUserLogs: vi.fn(),
};

vi.mock("@build/server/bff/backend", () => ({
  backendClient: async () => client,
}));

const getGitHubSession = vi.fn();
vi.mock("@build/server/cookies/github", () => ({
  getGitHubSession: () => getGitHubSession(),
}));

function getReq(qs = "") {
  return new Request(`http://localhost:3000/api/bff/operate/bots${qs}`);
}

function postJson(body: unknown) {
  return new Request("http://localhost:3000/api/bff/operate/bots", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function patchJson(body: unknown) {
  return new Request("http://localhost:3000/api/bff/operate/bots", {
    method: "PATCH",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function commandSecretReq(botId: string) {
  return new Request(
    `http://localhost:3000/api/bff/operate/bots/${botId}/command-secret`,
  );
}

function webhookReq(botId: string) {
  return new Request(
    `http://localhost:3000/api/bff/operate/bots/${botId}/webhook`,
    { method: "POST", headers: { origin: "http://localhost:3000" } },
  );
}

function deleteReq(qs: string) {
  return new Request(`http://localhost:3000/api/bff/operate/bots${qs}`, {
    method: "DELETE",
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
  clearOperateCachesForTesting();
  client.listUserProjects.mockReset();
  client.listUserProjectBots.mockReset();
  client.createUserProjectBot.mockReset();
  client.deleteUserProjectBot.mockReset();
  client.listUserBots.mockReset();
  client.createUserBot.mockReset();
  client.updateUserBot.mockReset();
  client.revealUserBotCommandSecret.mockReset();
  client.deleteUserBot.mockReset();
  client.getUserProjectUsage.mockReset();
  client.getUserProjectStatement.mockReset();
  client.getUserObservability.mockReset();
  client.getUserPayments.mockReset();
  client.listUserTransactions.mockReset();
  client.getUserStatements.mockReset();
  client.getUserUsage.mockReset();
  client.listUserLogs.mockReset();
  client.getUserProjectObservability.mockReset();
  client.getBuilderApplicationDetail.mockReset();
  client.listUserProjectTransactions.mockReset();
  client.listUserProjectLogs.mockReset();
  client.listUserProjectDeployments.mockReset();
  getGitHubSession.mockReset();
  telemetry.capture.mockReset();
  telemetry.log.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("operateBotsRoute", () => {
  it("401s the bots list when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateBotsRoute(getReq());
    expect(res.status).toBe(401);
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("lists builder-wide bots with applications from every bound platform", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      {
        id: 42,
        repositoryLink: "o/world-markets",
        platformName: "world-markets",
        apps: [{ id: 77, name: "world-markets" }],
      },
    ]);
    client.listUserBots.mockResolvedValue([
      { id: "b1", platformUsername: "mybot" },
    ]);
    const res = await operateBotsRoute(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      projects: [
        {
          platformName: "world-markets",
          apps: [{ id: 77, name: "world-markets" }],
        },
      ],
      bots: [{ id: "b1", platformUsername: "mybot" }],
    });
    expect(client.listUserProjects).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      platform: undefined,
    });
    expect(client.listUserBots).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "gh-1",
      }),
    );
  });

  it("does not fan out over every owned source", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 1, apps: [] },
      { id: 2, apps: [] },
    ]);
    client.listUserBots.mockResolvedValue([
      { id: "b1", platformUsername: "one" },
    ]);
    const res = await operateBotsRoute(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bots).toHaveLength(1);
    expect(client.listUserBots).toHaveBeenCalledTimes(1);
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

    const res = await operateBotsRoute(getReq());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "failed" });
    expect(telemetry.capture).not.toHaveBeenCalled();
    expect(telemetry.log).toHaveBeenCalledOnce();
    expect(telemetry.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "operate.owned_sources",
        upstream: "rust",
        upstreamStatus: 503,
      }),
    );
  });
});

describe("operateBotsCreateRoute", () => {
  it("401s create when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateBotsCreateRoute(
      postJson({
        applicationIds: [1],
        handoverApplicationId: 1,
        credential: "t",
      }),
    );
    expect(res.status).toBe(401);
    expect(client.createUserBot).not.toHaveBeenCalled();
  });

  it("rejects a create for apps the user does not own", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    const res = await operateBotsCreateRoute(
      postJson({
        applicationIds: [1],
        handoverApplicationId: 1,
        credential: "t",
      }),
    );
    expect(res.status).toBe(403);
    expect(client.createUserBot).not.toHaveBeenCalled();
  });

  it("400s an invalid body before calling the backend", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    let res = await operateBotsCreateRoute(
      postJson({
        applicationIds: "nope",
        handoverApplicationId: 1,
        credential: "t",
      }),
    );
    expect(res.status).toBe(400);

    res = await operateBotsCreateRoute(
      postJson({
        applicationIds: [1],
        handoverApplicationId: 1,
        credential: "   ",
      }),
    );
    expect(res.status).toBe(400);
    expect(client.createUserBot).not.toHaveBeenCalled();
  });

  it("creates a bot with owned cross-source app mappings", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [{ id: 7 }] }]);
    client.createUserBot.mockResolvedValue({
      id: "b1",
      platform: "telegram",
    });
    const res = await operateBotsCreateRoute(
      postJson({
        applicationIds: [7],
        handoverApplicationId: 7,
        credential: "secret-token",
        label: "My Bot",
        miniAppUrl: "",
        commandEndpoint: "https://api.world.inc/commands/",
        commands: ["/B", "p"],
      }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      bot: { id: "b1", platform: "telegram" },
    });
    // Shape only: values are forwarded untouched (blank URL → null) and the
    // manager canonicalises trailing slashes, case and leading slashes.
    expect(client.createUserBot).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "gh-1",
        applicationIds: [7],
        handoverApplicationId: 7,
        botPlatform: "telegram",
        credential: "secret-token",
        label: "My Bot",
        miniAppUrl: null,
        commandEndpoint: "https://api.world.inc/commands/",
        commands: ["/B", "p"],
      }),
    );
  });

  it("omits command config the body did not mention", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [{ id: 7 }] }]);
    client.createUserBot.mockResolvedValue({ id: "b1" });
    await operateBotsCreateRoute(
      postJson({
        applicationIds: [7],
        handoverApplicationId: 7,
        credential: "secret-token",
      }),
    );
    const input = client.createUserBot.mock.calls[0][0];
    expect(input).not.toHaveProperty("miniAppUrl");
    expect(input).not.toHaveProperty("commandEndpoint");
    expect(input).not.toHaveProperty("commands");
  });

  it("400s a shape-invalid command config before calling the backend", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [{ id: 7 }] }]);
    const base = {
      applicationIds: [7],
      handoverApplicationId: 7,
      credential: "secret-token",
    };
    for (const bad of [
      { miniAppUrl: 42 },
      { commandEndpoint: ["x"] },
      { commands: "b, p" },
      { commands: ["b", 3] },
    ]) {
      const res = await operateBotsCreateRoute(postJson({ ...base, ...bad }));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: "invalid bot command config",
      });
    }
    expect(client.createUserBot).not.toHaveBeenCalled();
  });

  it("forwards the manager's 400 message instead of mirroring its rules", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [{ id: 7 }] }]);
    client.createUserBot.mockRejectedValue(
      new BackendError(
        "create_user_bot",
        400,
        "create_user_bot failed (400)",
        JSON.stringify({ error: "command `start` is reserved" }),
      ),
    );
    const res = await operateBotsCreateRoute(
      postJson({
        applicationIds: [7],
        handoverApplicationId: 7,
        credential: "secret-token",
        commandEndpoint: "https://api.world.inc/commands",
        commands: ["start"],
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "command `start` is reserved",
    });
    expect(telemetry.capture).not.toHaveBeenCalled();
  });

  it("never logs or echoes the credential value on failure paths", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [{ id: 7 }] }]);
    client.createUserBot.mockRejectedValue(new Error("backend down"));
    const res = await operateBotsCreateRoute(
      postJson({
        applicationIds: [7],
        handoverApplicationId: 7,
        credential: "top-secret",
      }),
    );
    const text = await res.text();
    expect(text).not.toContain("top-secret");
  });
});

describe("operateBotsUpdateRoute", () => {
  const owned = () =>
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [{ id: 7 }] }]);

  it("forwards only the fields the body names, clearing blank URLs", async () => {
    setSession({ githubUserId: "gh-1" });
    owned();
    client.updateUserBot.mockResolvedValue({ id: "b1" });
    const res = await operateBotsUpdateRoute(
      patchJson({
        botId: "b1",
        applicationIds: [7],
        handoverApplicationId: 7,
        commandEndpoint: "",
        commands: [],
      }),
    );
    expect(res.status).toBe(200);
    const input = client.updateUserBot.mock.calls[0][0];
    expect(input).toMatchObject({
      botId: "b1",
      applicationIds: [7],
      handoverApplicationId: 7,
      commandEndpoint: null,
      commands: [],
    });
    expect(input).not.toHaveProperty("miniAppUrl");
  });

  it("passes the manager's webhook warning beside the saved bot, never inside it", async () => {
    setSession({ githubUserId: "gh-1" });
    owned();
    client.updateUserBot.mockResolvedValue({
      id: "b1",
      webhookWarning: "Telegram setWebhook failed (502 Bad Gateway)",
    });
    const res = await operateBotsUpdateRoute(
      patchJson({ botId: "b1", applicationIds: [7], handoverApplicationId: 7 }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      bot: { id: "b1" },
      webhookWarning: "Telegram setWebhook failed (502 Bad Gateway)",
    });

    client.updateUserBot.mockResolvedValue({ id: "b1" });
    const clean = await operateBotsUpdateRoute(
      patchJson({ botId: "b1", applicationIds: [7], handoverApplicationId: 7 }),
    );
    await expect(clean.json()).resolves.toEqual({ bot: { id: "b1" } });
  });

  it("400s a shape-invalid command config and forwards a manager 400", async () => {
    setSession({ githubUserId: "gh-1" });
    owned();
    let res = await operateBotsUpdateRoute(
      patchJson({
        botId: "b1",
        applicationIds: [7],
        handoverApplicationId: 7,
        miniAppUrl: { url: "x" },
      }),
    );
    expect(res.status).toBe(400);
    expect(client.updateUserBot).not.toHaveBeenCalled();

    client.updateUserBot.mockRejectedValue(
      new BackendError(
        "update_user_bot",
        400,
        "update_user_bot failed (400)",
        JSON.stringify({ error: "commands require a command_endpoint" }),
      ),
    );
    res = await operateBotsUpdateRoute(
      patchJson({
        botId: "b1",
        applicationIds: [7],
        handoverApplicationId: 7,
        commands: ["b"],
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "commands require a command_endpoint",
    });
  });
});

describe("operateBotsCommandSecretRoute", () => {
  it("401s when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateBotsCommandSecretRoute(commandSecretReq("b1"));
    expect(res.status).toBe(401);
    expect(client.revealUserBotCommandSecret).not.toHaveBeenCalled();
  });

  it("reveals the secret through the session's builder id", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    client.revealUserBotCommandSecret.mockResolvedValue({
      commandSecret: "deadbeef",
    });
    const res = await operateBotsCommandSecretRoute(commandSecretReq("b1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ commandSecret: "deadbeef" });
    expect(client.revealUserBotCommandSecret).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      botId: "b1",
    });
  });

  it("forwards the manager's rejection of a bot the builder does not own", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    client.revealUserBotCommandSecret.mockRejectedValue(
      new BackendError(
        "reveal_user_bot_command_secret",
        404,
        "reveal_user_bot_command_secret failed (404)",
        JSON.stringify({ error: "bot not found" }),
      ),
    );
    const res = await operateBotsCommandSecretRoute(commandSecretReq("b9"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "bot not found" });
  });
});

describe("operateBotsWebhookRoute", () => {
  it("401s when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateBotsWebhookRoute(webhookReq("b1"));
    expect(res.status).toBe(401);
    expect(client.checkUserBotWebhook).not.toHaveBeenCalled();
  });

  it("checks the webhook through the session's builder id", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    const webhook = {
      urlMatches: false,
      pendingUpdateCount: 3,
      lastErrorMessage: null,
      reasserted: true,
      warning: null,
    };
    client.checkUserBotWebhook.mockResolvedValue(webhook);
    const res = await operateBotsWebhookRoute(webhookReq("b1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ webhook });
    expect(client.checkUserBotWebhook).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      botId: "b1",
    });
  });

  it("forwards the manager's rejection of a bot the builder does not own", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    client.checkUserBotWebhook.mockRejectedValue(
      new BackendError(
        "check_user_bot_webhook",
        404,
        "check_user_bot_webhook failed (404)",
        JSON.stringify({ error: "bot registration not found" }),
      ),
    );
    const res = await operateBotsWebhookRoute(webhookReq("b9"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "bot registration not found",
    });
  });
});

describe("operateBotsDeleteRoute", () => {
  it("401s delete when not signed in with GitHub", async () => {
    clearSession();
    const res = await operateBotsDeleteRoute(deleteReq("?botId=b1"));
    expect(res.status).toBe(401);
    expect(client.deleteUserBot).not.toHaveBeenCalled();
  });

  it("400s a delete missing botId", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    const res = await operateBotsDeleteRoute(deleteReq(""));
    expect(res.status).toBe(400);
    expect(client.deleteUserBot).not.toHaveBeenCalled();
  });

  it("deletes a bot for an owned source", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([{ id: 42, apps: [] }]);
    client.deleteUserBot.mockResolvedValue(undefined);
    const res = await operateBotsDeleteRoute(deleteReq("?botId=b1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(client.deleteUserBot).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "gh-1",
        botId: "b1",
      }),
    );
  });
});

function usageReq(qs = "") {
  return new Request(`http://localhost:3000/api/bff/operate/usage${qs}`);
}
function observabilityReq() {
  return new Request("http://localhost:3000/api/bff/operate/observability");
}
function transactionsReq(qs = "") {
  return new Request(`http://localhost:3000/api/bff/operate/transactions${qs}`);
}
function logsReq(qs = "") {
  return new Request(`http://localhost:3000/api/bff/operate/logs${qs}`);
}
function appDetailReq(qs = "?applicationId=77") {
  return new Request(
    `http://localhost:3000/api/bff/operate/observability/detail${qs}`,
  );
}

const oneSource = (platformName = "community") =>
  client.listUserProjects.mockResolvedValue([
    { id: 900, repositoryLink: "o/r", platformName, apps: [] },
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

function sharedSettlementPayments(applicationId: number | null = null) {
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
        application: applicationId == null ? null : `app-${applicationId}`,
        applicationId,
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
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "community,somm.finance");
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
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "community");
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
          application: "real-bot",
          applicationId: 1,
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
    expect(body.statement.revenue[0].application).toBe("real-bot");
  });

  it.skip("deduplicates a recipient-bucket settlement shared by two projects", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 900, repositoryLink: "o/one", apps: [] },
      { id: 901, repositoryLink: "o/two", apps: [] },
    ]);
    client.getUserProjectUsage.mockImplementation(({ projectId }) =>
      Promise.resolve({
        ...emptyUsage,
        project: { id: projectId },
      }),
    );
    const payment = sharedSettlementPayments();
    payment.buckets[0].outstandingCredits = 25;
    client.getUserProjectStatement.mockImplementation(({ projectId }) =>
      Promise.resolve({
        project: { id: projectId },
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
      }),
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
  it("reuses a recent account-scoped manager read", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        scope: "owned_applications",
        monitoring: null,
        apps: [],
        dashboardLinks: [],
        platformMetrics: [],
      },
    ]);

    const first = await operateObservabilityRoute(observabilityReq());
    const second = await operateObservabilityRoute(observabilityReq());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(client.getUserObservability).toHaveBeenCalledTimes(1);
  });

  it("keeps a partial live card partial instead of grafting example trends", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        scope: "owned_applications",
        monitoring: {
          provider: "grafana_prometheus",
          status: "ok",
          windowSeconds: 900,
        },
        apps: [
          {
            applicationId: 1,
            application: "real-bot",
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
    const card = body.apps.find(
      (a: { application: string }) => a.application === "real-bot",
    );
    expect(card.metrics.errorRate).toBe(0.5); // real value preserved
    expect(card.metrics.p95LatencyMs).toBe(1234); // real value preserved
    expect(card.metrics.chats24h).toBeUndefined();
    expect(card.metrics.chatsHourly).toBeUndefined();
  });

  it("returns an empty app list when the account has no live apps", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        scope: "owned_applications",
        monitoring: null,
        apps: [],
        dashboardLinks: [],
        platformMetrics: [],
      },
    ]);

    const res = await operateObservabilityRoute(observabilityReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.example).toBeUndefined();
    expect(body.apps).toEqual([]);
    expect(body.monitoring.status).toBe("unconfigured");
  });

  it("serves the whole account from one batch read when the manager has it", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    client.getUserObservability.mockResolvedValue([
      {
        project: { id: 900 },
        platform: "community",
        scope: "owned_applications",
        monitoring: {
          provider: "grafana_prometheus",
          status: "ok",
          windowSeconds: 900,
        },
        apps: [
          {
            applicationId: 1,
            application: "real-bot",
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
        scope: "owned_applications",
        monitoring: {
          provider: "grafana_prometheus",
          status: "ok",
          windowSeconds: 900,
        },
        apps: [
          {
            applicationId: 2,
            application: "somm-agent",
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
    // One account-wide read, cached across requests; no per-source fan-out.
    expect(client.getUserObservability).toHaveBeenCalledTimes(1);
    expect(client.getUserObservability).toHaveBeenCalledWith(
      expect.objectContaining({ githubUserId: "gh-1" }),
    );
    expect(client.getUserProjectObservability).not.toHaveBeenCalled();
    expect(body.degraded).toBeUndefined();
    expect(body.payments).toBeUndefined();
    expect(
      body.apps.map((app: { application: string }) => app.application),
    ).toEqual(["real-bot"]);
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
              apps: [],
            },
          ]
        : [
            {
              id: 900,
              repositoryLink: "o/r",
              platformName: "community",
              apps: [],
            },
          ],
    );
    const snapshot = (id: number, platform: string, application: string) => ({
      project: { id },
      platform,
      scope: "owned_applications",
      monitoring: {
        provider: "grafana_prometheus",
        status: "ok",
        windowSeconds: 900,
      },
      apps: [
        {
          applicationId: id,
          application,
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
      snapshot(900, "community", "real-bot"),
      snapshot(1620, "somm.finance", "somm-agent"),
    ]);

    const res = await operateObservabilityRoute(
      new Request(
        "http://localhost:3000/api/bff/operate/observability?platform=somm.finance",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // Still one account-wide read — only the response is narrowed.
    expect(client.getUserObservability).toHaveBeenCalledWith(
      expect.objectContaining({ githubUserId: "gh-1" }),
    );
    expect(
      body.apps.map((app: { application: string }) => app.application),
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
      new Request("http://localhost:3000/api/bff/operate/payments"),
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

describe("operateAppDetailRoute", () => {
  it("requires a valid application id", async () => {
    const res = await operateAppDetailRoute(
      appDetailReq("?applicationId=nope"),
    );
    expect(res.status).toBe(400);
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });

  it("derives the parent project and bound platform from the application", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource("world-markets");
    client.getBuilderApplicationDetail.mockResolvedValue({
      project: { id: 900 },
      platform: "community",
      app: { applicationId: 77, name: "demo" },
    });
    client.getUserProjectObservability.mockResolvedValue({
      apps: [{ applicationId: 77, application: "demo", status: "healthy" }],
    });
    client.listUserProjectTransactions.mockResolvedValue({
      project: { id: 900 },
      platform: "community",
      transactions: [
        { id: "tx-match", applicationId: 77 },
        { id: "tx-other", applicationId: 88 },
      ],
      nextCursor: null,
    });
    client.listUserProjectLogs.mockResolvedValue({
      project: { id: 900 },
      platform: "community",
      logs: [
        { id: "log-match", applicationId: 77 },
        { id: "log-other", applicationId: 88 },
      ],
      nextCursor: null,
    });
    client.listUserProjectDeployments.mockResolvedValue([
      { deploymentId: "dep-1", apps: [] },
    ]);

    const res = await operateAppDetailRoute(appDetailReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.detail.app).toEqual({ applicationId: 77, name: "demo" });
    expect(body.health).toEqual({
      applicationId: 77,
      application: "demo",
      status: "healthy",
    });
    expect(body.transactions).toEqual([{ id: "tx-match", applicationId: 77 }]);
    expect(body.logs).toEqual([{ id: "log-match", applicationId: 77 }]);
    expect(body.deployments).toEqual([{ deploymentId: "dep-1", apps: [] }]);
    expect(client.getBuilderApplicationDetail).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      applicationId: 77,
    });
    expect(client.listUserProjects).not.toHaveBeenCalled();
  });
});

describe("account-wide batch reads", () => {
  beforeEach(() => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 900, repositoryLink: "o/one", apps: [] },
      { id: 1620, repositoryLink: "partner/app", apps: [] },
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
          project: { id: 1620, repositoryLink: "partner/app" },
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
    expect(body.nextCursor).toEqual({
      batch: { createdAt: 1_700_000_000, id: "tx:a" },
    });
  });

  /** The merged page spans every platform the account owns; the page it feeds
   *  is scoped to one. Rows for a project this platform does not list are
   *  dropped, and the global cursor still carries the reader forward. */
  it("scopes the merged transactions page to the selected platform", async () => {
    client.listUserProjects.mockResolvedValue([
      { id: 900, repositoryLink: "o/one", platformName: "community", apps: [] },
    ]);
    client.listUserTransactions.mockResolvedValue({
      projects: [
        {
          project: { id: 900, repositoryLink: "o/one" },
          platform: "community",
        },
        {
          project: { id: 1620, repositoryLink: "partner/app" },
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
    expect(body.nextCursor).toEqual({
      batch: { createdAt: 1_700_000_000, id: "tx:a" },
    });
  });

  it("passes the batch cursor through and skips statements past page one", async () => {
    client.listUserTransactions.mockResolvedValue({
      projects: [],
      transactions: [],
      nextCursor: null,
    });

    const cursor = encodeURIComponent(
      JSON.stringify({ batch: { createdAt: 1_700_000_000, id: "tx:a" } }),
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
            application: "app",
            applicationId: 1,
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
      batch: {
        occurredAt: 1_699_999_999,
        eventType: "usage",
        id: "settle:shared",
      },
    });
  });

  /** The merged stream spans every platform the account owns. Rows for a
   *  project this platform does not list are dropped; account-level rows
   *  (a shared partner settlement has no project) belong to every view. */
  it("scopes the merged log stream to the selected platform", async () => {
    client.listUserProjects.mockResolvedValue([
      { id: 900, repositoryLink: "o/one", platformName: "community", apps: [] },
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
      new Request("http://localhost:3000/api/bff/operate/observability"),
    );
    // Yield past the microtasks the route needs to reach its manager call.
    // If the snapshot were sequenced after the source list, it could not have
    // started while that list is still unresolved.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshotStarted).toBe(true);
    expect(client.getUserObservability).toHaveBeenCalledOnce();

    release([{ id: 42, repositoryLink: "o/r", apps: [] }]);
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
      new Request("http://localhost:3000/api/bff/operate/logs"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pageStarted).toBe(true);

    release([{ id: 42, repositoryLink: "o/r", apps: [] }]);
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
      new Request("http://localhost:3000/api/bff/operate/transactions"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pageStarted).toBe(true);
    expect(client.listUserTransactions).toHaveBeenCalledOnce();

    release([{ id: 42, repositoryLink: "o/r", apps: [] }]);
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
      new Request("http://localhost:3000/api/bff/operate/usage"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sweepStarted).toBe(true);
    expect(client.getUserUsage).toHaveBeenCalledOnce();

    release([{ id: 42, repositoryLink: "o/r", apps: [] }]);
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
      new Request("http://localhost:3000/api/bff/operate/payments"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ledgerStarted).toBe(true);

    release([{ id: 42, repositoryLink: "o/r", apps: [] }]);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(client.getUserPayments).toHaveBeenCalledOnce();
  });

  /** A ledger row for a project on another platform must not surface here —
   *  the payment card sits on a page scoped to one platform. */
  it("scopes unfiltered payments to the selected platform's projects", async () => {
    setSession({ githubUserId: "gh-1" });
    oneSource();
    const withResource = (application: string) => ({
      ...emptyPayments(),
      resources: [{ application, priced: true }],
    });
    client.getUserPayments.mockResolvedValue([
      { project: { id: 900 }, payments: withResource("real-bot") },
      { project: { id: 1620 }, payments: withResource("somm-agent") },
    ]);

    const res = await operatePaymentsRoute(
      new Request("http://localhost:3000/api/bff/operate/payments"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(client.getUserPayments).toHaveBeenCalledOnce();
    expect(
      body.payments.resources.map(
        (r: { application: string }) => r.application,
      ),
    ).toEqual(["real-bot"]);
  });

  /** …but a source-scoped request still must, because that is where
   *  `projectId` is proven to belong to the signed-in user. */
  it("still resolves the source list to authorize a scoped payments request", async () => {
    setSession({ githubUserId: "gh-1" });
    client.listUserProjects.mockResolvedValue([
      { id: 42, repositoryLink: "o/r", apps: [] },
    ]);
    client.getUserPayments.mockResolvedValue([]);

    const ok = await operatePaymentsRoute(
      new Request(
        "http://localhost:3000/api/bff/operate/payments?projectId=42",
      ),
    );
    expect(ok.status).toBe(200);
    expect(client.listUserProjects).toHaveBeenCalled();

    const foreign = await operatePaymentsRoute(
      new Request(
        "http://localhost:3000/api/bff/operate/payments?projectId=99",
      ),
    );
    expect(foreign.status).toBe(404);
  });
});
