// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendClient } from "../src/backend";

function client() {
  return new BackendClient({
    aomi: { backendUrl: "https://api.test", activationToken: "t" },
  });
}

describe("BackendClient bots", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists bots for an owned source", async () => {
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
                default_app: "binance",
                platform_bot_id: "123",
                platform_username: "mybot",
                webhook_url: "https://x/y",
                thread_mode: "single",
                created_at: 1,
                apps: [
                  {
                    application_id: 7,
                    name: "world",
                    is_primary: true,
                    tenant_base_url: "https://api.world.inc/mini-app",
                    commands: ["b", "p"],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const bots = await client().listUserProjectBots({
      githubUserId: "gh-1",
      platform: "community",
      projectId: 42,
    });

    expect(bots[0].platformUsername).toBe("mybot");
    expect(bots[0].defaultApp).toBe("binance");
    expect(bots[0].apps[0]).toMatchObject({
      tenantBaseUrl: "https://api.world.inc/mini-app",
      commands: ["b", "p"],
    });
    expect(fetchImpl.mock.calls[0][0]).toContain(
      "/api/integrations/github-app/user/projects/42/bots?",
    );
  });

  it("sends tenant command config when creating a builder bot", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        bot_registration: {
          id: "b1",
          platform: "telegram",
          status: "active",
          default_app: "world",
          platform_bot_id: "1",
          thread_mode: "single",
          created_at: 1,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await client().createUserBot({
      githubUserId: "gh-1",
      applicationIds: [7],
      primaryApplicationId: 7,
      botPlatform: "telegram",
      credential: "secret",
      tenantBaseUrl: "https://api.world.inc/mini-app",
      commands: ["b", "p"],
    });

    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      tenant_base_url: "https://api.world.inc/mini-app",
      commands: ["b", "p"],
    });
  });

  it("never surfaces a credential field", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            bot_registration: {
              id: "b1",
              platform: "telegram",
              status: "active",
              default_app: "binance",
              platform_bot_id: "1",
              thread_mode: "single",
              created_at: 1,
              credential_ciphertext: "LEAK",
            },
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
