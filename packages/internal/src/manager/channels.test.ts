// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerClient } from "./client";

function client() {
  return new ManagerClient({ url: "https://api.test", bearer: "t" });
}

const CREATED = {
  id: "b1",
  kind: "telegram",
  status: "active",
  agent: "world",
  agent_id: 7,
  mini_app_url: null,
  command_endpoint: null,
  commands: [],
  external_bot_id: "1",
  thread_mode: "single",
  created_at: 1,
};

describe("manager channels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists channels with channel-level command config", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            channels: [
              {
                id: "b1",
                kind: "telegram",
                status: "active",
                label: null,
                agent_id: 7,
                mini_app_url: null,
                command_endpoint: "https://api.world.inc/commands",
                commands: ["b", "p"],
                external_bot_id: "123",
                platform_username: "mybot",
                webhook_url: "https://x/y",
                thread_mode: "single",
                created_at: 1,
                agent: {
                  id: 7,
                  name: "publisher/world",
                  display_name: "world",
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const channels = await client().listUserChannels({ githubUserId: "gh-1" });

    expect(channels[0]).toMatchObject({
      platformUsername: "mybot",
      agentId: 7,
      miniAppUrl: null,
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    });
    expect(channels[0].agent).toEqual({
      id: 7,
      projectId: null,
      projectLabel: null,
      name: "publisher/world",
      displayName: "world",
      platform: null,
    });
    expect(fetchImpl.mock.calls[0][0]).toContain(
      "/api/integrations/github-app/user/channels?",
    );
  });

  it("sends agent_id and command config when creating a channel", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ channel: CREATED }));
    vi.stubGlobal("fetch", fetchImpl);

    await client().createUserChannel({
      githubUserId: "gh-1",
      agentId: 7,
      kind: "telegram",
      credential: "secret",
      commandEndpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    });

    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      kind: "telegram",
      agent_id: 7,
      command_endpoint: "https://api.world.inc/commands",
      commands: ["b", "p"],
    });
    expect(body).not.toHaveProperty("primary_agent_id");
    expect(body).not.toHaveProperty("mini_app_url");
  });

  it("sends agent_id and null URL clears on update", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ channel: CREATED }));
    vi.stubGlobal("fetch", fetchImpl);

    await client().updateUserChannel({
      githubUserId: "gh-1",
      channelId: "b1",
      agentId: 7,
      miniAppUrl: null,
      commands: [],
    });

    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/integrations/github-app/user/channels/b1?");
    expect(request.method).toBe("PATCH");
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent_id: 7,
      mini_app_url: null,
      commands: [],
    });
    expect(body).not.toHaveProperty("command_endpoint");
  });

  it("reveals the per-channel command secret", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ command_secret: "deadbeef" }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await client().revealUserChannelCommandSecret({
      githubUserId: "gh-1",
      channelId: "b1",
    });

    expect(result).toEqual({ commandSecret: "deadbeef" });
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/api/integrations/github-app/user/channels/b1/command-secret?github_user_id=gh-1",
    );
    expect(request.method).toBe("GET");
  });

  it("surfaces the manager's webhook warning on update, and only then", async () => {
    let fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            channel: CREATED,
            webhook_warning: "Telegram setWebhook failed (502 Bad Gateway)",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const warned = await client().updateUserChannel({
      githubUserId: "gh-1",
      channelId: "b1",
      agentId: 7,
    });
    expect(warned.id).toBe("b1");
    expect(warned.webhookWarning).toBe(
      "Telegram setWebhook failed (502 Bad Gateway)",
    );

    fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ channel: CREATED }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const clean = await client().updateUserChannel({
      githubUserId: "gh-1",
      channelId: "b1",
      agentId: 7,
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

    const status = await client().checkUserChannelWebhook({
      githubUserId: "gh-1",
      channelId: "b1",
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
      "/api/integrations/github-app/user/channels/b1/webhook?github_user_id=gh-1",
    );
    expect(request.method).toBe("POST");
  });

  it("rejects a webhook report that lacks the comparison", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      client().checkUserChannelWebhook({
        githubUserId: "gh-1",
        channelId: "b1",
      }),
    ).rejects.toThrow(/missing the webhook status/);
  });

  it("never surfaces a credential field", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            channel: { ...CREATED, credential_ciphertext: "LEAK" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const channel = await client().createUserChannel({
      githubUserId: "gh-1",
      agentId: 7,
      kind: "telegram",
      credential: "tok",
    });
    expect(JSON.stringify(channel)).not.toContain("LEAK");
  });
});
