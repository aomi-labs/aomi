// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendClient } from "../src/backend";

function client() {
  return new BackendClient({
    aomi: { backendUrl: "https://api.test", activationToken: "t" },
  });
}

const CREATED = {
  id: "b1",
  platform: "telegram",
  status: "active",
  handover_app: "world",
  handover_app_id: 7,
  mini_app_url: null,
  command_endpoint: null,
  commands: [],
  platform_bot_id: "1",
  thread_mode: "single",
  created_at: 1,
};

describe("BackendClient bots", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists bots with bot-level command config", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            bot_registrations: [
              {
                id: "b1",
                platform: "telegram",
                status: "active",
                label: null,
                handover_app: "binance",
                handover_app_id: 7,
                mini_app_url: null,
                command_endpoint: "https://api.world.inc/commands",
                commands: ["b", "p"],
                platform_bot_id: "123",
                platform_username: "mybot",
                webhook_url: "https://x/y",
                thread_mode: "single",
                created_at: 1,
                apps: [{ application_id: 7, name: "world", is_primary: true }],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const bots = await client().listUserBots({ githubUserId: "gh-1" });

    expect(bots[0]).toMatchObject({
      platformUsername: "mybot",
      handoverApp: "binance",
      handoverAppId: 7,
      miniAppUrl: null,
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    });
    expect(bots[0].apps[0]).toEqual({
      applicationId: 7,
      projectId: null,
      projectLabel: null,
      name: "world",
      label: "world",
      platform: null,
      isPrimary: true,
    });
    expect(fetchImpl.mock.calls[0][0]).toContain(
      "/api/integrations/github-app/user/bots?",
    );
  });

  it("sends handover_application_id and command config when creating a bot", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ bot_registration: CREATED }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await client().createUserBot({
      githubUserId: "gh-1",
      applicationIds: [7],
      handoverApplicationId: 7,
      botPlatform: "telegram",
      credential: "secret",
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    });

    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      platform: "telegram",
      application_ids: [7],
      handover_application_id: 7,
      command_endpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    });
    expect(body).not.toHaveProperty("primary_application_id");
    expect(body).not.toHaveProperty("mini_app_url");
  });

  it("sends handover_application_id and null URL clears on update", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ bot_registration: CREATED }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await client().updateUserBot({
      githubUserId: "gh-1",
      botId: "b1",
      applicationIds: [7],
      handoverApplicationId: 7,
      miniAppUrl: null,
      commands: [],
    });

    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/integrations/github-app/user/bots/b1?");
    expect(request.method).toBe("PATCH");
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      application_ids: [7],
      handover_application_id: 7,
      mini_app_url: null,
      commands: [],
    });
    expect(body).not.toHaveProperty("command_endpoint");
  });

  it("reveals the per-bot command secret", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ command_secret: "deadbeef" }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await client().revealUserBotCommandSecret({
      githubUserId: "gh-1",
      botId: "b1",
    });

    expect(result).toEqual({ commandSecret: "deadbeef" });
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/api/integrations/github-app/user/bots/b1/command-secret?github_user_id=gh-1",
    );
    expect(request.method).toBe("GET");
  });

  it("surfaces the manager's webhook warning on update, and only then", async () => {
    let fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            bot_registration: CREATED,
            webhook_warning: "Telegram setWebhook failed (502 Bad Gateway)",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const warned = await client().updateUserBot({
      githubUserId: "gh-1",
      botId: "b1",
      applicationIds: [7],
      handoverApplicationId: 7,
    });
    expect(warned.id).toBe("b1");
    expect(warned.webhookWarning).toBe(
      "Telegram setWebhook failed (502 Bad Gateway)",
    );

    fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ bot_registration: CREATED }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const clean = await client().updateUserBot({
      githubUserId: "gh-1",
      botId: "b1",
      applicationIds: [7],
      handoverApplicationId: 7,
    });
    expect(clean).not.toHaveProperty("webhookWarning");
  });

  it("checks the webhook with a POST and camel-cases Telegram's report", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            webhook: {
              url_matches: false,
              pending_update_count: 12,
              last_error_message: "Wrong response from the webhook: 404",
              reasserted: true,
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const status = await client().checkUserBotWebhook({
      githubUserId: "gh-1",
      botId: "b1",
    });

    expect(status).toEqual({
      urlMatches: false,
      pendingUpdateCount: 12,
      lastErrorMessage: "Wrong response from the webhook: 404",
      reasserted: true,
      warning: null,
    });
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/api/integrations/github-app/user/bots/b1/webhook?github_user_id=gh-1",
    );
    expect(request.method).toBe("POST");
  });

  it("never surfaces a credential field", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            bot_registration: { ...CREATED, credential_ciphertext: "LEAK" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const bot = await client().createUserProjectBot({
      githubUserId: "gh-1",
      platform: "community",
      projectId: 42,
      applicationId: 7,
      botPlatform: "telegram",
      credential: "tok",
    } as never);
    expect(JSON.stringify(bot)).not.toContain("LEAK");
  });
});
