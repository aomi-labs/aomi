import { describe, expect, it, vi } from "vitest";

import { Aomi } from "./aomi";
import { AccountGraphApiError } from "../account/graph";
import { isAomiError } from "../api-error";

type Call = { method: string; path: string; body: unknown; csrf: boolean };

function backend(routes: Record<string, (body: unknown) => Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.pathname + url.search,
      body,
      csrf: new Headers(init?.headers).has("x-aomi-csrf"),
    });
    const route = routes[`${method} ${url.pathname}`];
    return route
      ? route(body)
      : Response.json({ error: "unexpected" }, { status: 500 });
  });
  return {
    calls,
    aomi: new Aomi({ baseUrl: "https://chat.example", guest: false, fetch }),
  };
}

const apps = [
  { name: "polymarket", application_id: 7, is_installed: false },
  { name: "lifi", application_id: 9, is_installed: true },
];

describe("aomi.account", () => {
  it("reads the profile and the wallets, and an agent wallet's balances", async () => {
    const { aomi, calls } = backend({
      "GET /v1/account": () =>
        Response.json({
          user: { id: "u1" },
          linkedAccounts: [{ id: "i1", provider: "github", subject: "1" }],
          wallets: [],
          session: { betterAuthUserId: "b1" },
        }),
      "GET /v1/account/wallets": () =>
        Response.json({
          wallets: [
            {
              id: "w_4",
              kind: "agent",
              family: "evm",
              address: "0x8f3a",
              label: "Trading",
              custom_label: null,
              browser_app: null,
              provider: null,
              created_at: 1,
              agent_wallet_id: "aw_1",
              maker_app: null,
            },
          ],
        }),
      "GET /v1/account/agent-wallets/aw_1/balances": () =>
        Response.json({ networks: [] }),
    });

    expect((await aomi.account.me()).user).toEqual({ id: "u1" });
    expect(await aomi.account.logins.list()).toEqual([
      { id: "i1", provider: "github", subject: "1" },
    ]);
    const [trading] = await aomi.account.wallets.list();
    expect(trading?.label).toBe("Trading");
    await expect(aomi.account.wallets.balance(trading!.id)).resolves.toEqual({
      networks: [],
    });
    expect(calls.at(-1)?.path).toBe(
      "/v1/account/agent-wallets/aw_1/balances?family=evm",
    );
  });

  it("installs an app by name and sets its credential", async () => {
    const { aomi, calls } = backend({
      "GET /v1/account/apps": () => Response.json(apps),
      "POST /v1/account/apps/7": () =>
        Response.json({
          application_id: 7,
          app: "polymarket",
          installed: true,
          apps: ["lifi", "polymarket"],
        }),
      "POST /v1/account/apps/7/secrets": () => Response.json({ slots: [] }),
    });

    await expect(
      aomi.account.apps.install("polymarket"),
    ).resolves.toMatchObject({ installed: true });
    await aomi.account.apps.credentials("polymarket").set("API_KEY", "k");
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      expect.objectContaining({ path: "/v1/account/apps/7", csrf: true }),
      expect.objectContaining({
        path: "/v1/account/apps/7/secrets",
        body: { secrets: { API_KEY: "k" } },
        csrf: true,
      }),
    ]);
    await expect(aomi.account.apps.install("nope")).rejects.toSatisfy((error) =>
      isAomiError(error, "app_not_found"),
    );
  });

  it("sets the guard at the current revision", async () => {
    const policy = (mode: string, revision: number) => ({
      mode,
      revision,
      scope: "account_default",
      source: "user",
    });
    const { aomi, calls } = backend({
      "GET /v1/account/transaction-safety": () =>
        Response.json(policy("guarded_only", 3)),
      "PUT /v1/account/transaction-safety": (body) =>
        Response.json(policy((body as { mode: string }).mode, 4)),
    });

    await expect(
      aomi.account.guard.set({ mode: "balanced" }),
    ).resolves.toMatchObject({ mode: "balanced", revision: 4 });
    expect(calls.at(-1)?.body).toEqual({
      mode: "balanced",
      expectedRevision: 3,
    });
    await expect(
      aomi.account.guard.set({ mode: "unrestricted" }),
    ).rejects.toSatisfy((error) => isAomiError(error, "invalid_mode"));
  });

  it("reads credits and the statement", async () => {
    const { aomi, calls } = backend({
      "GET /v1/account/credits": () => Response.json({ balance_microusd: 5 }),
      "GET /v1/account/statement": () =>
        Response.json({ entries: [], next_cursor: null }),
    });
    await expect(aomi.account.credits.get()).resolves.toEqual({
      balance_microusd: 5,
    });
    await expect(aomi.account.statement({ limit: 5 })).resolves.toEqual({
      entries: [],
      next_cursor: null,
    });
    expect(calls.at(-1)?.path).toBe("/v1/account/statement?limit=5");
  });

  it("carries a merge offer and Retry-After in the error", async () => {
    const offer = {
      ticket: "t1",
      other: {
        name: "Old",
        created_at: "2026-01-01",
        chats: 2,
        wallets: 1,
        credits: "0",
        dropped: [],
      },
    };
    const { aomi } = backend({
      "POST /v1/account/wallets/link": () =>
        Response.json(
          { error: "account_merge_available", ...offer },
          { status: 409, headers: { "retry-after": "3" } },
        ),
      "POST /v1/account/merge": () =>
        Response.json({ moved: { chats: 2, wallets: 1 }, account: {} }),
    });
    const error = await aomi.account.logins
      .link({
        family: "evm",
        address: "0x1",
        chainId: 1,
        nonce: "n",
        message: "m",
        signature: "s",
      })
      .catch((caught: unknown) => caught);
    expect(isAomiError(error, "account_merge_available")).toBe(true);
    expect((error as AccountGraphApiError).mergeOffer).toEqual(offer);
    expect((error as AccountGraphApiError).retryAfter).toBe(3);
    await expect(aomi.account.merge(offer.ticket)).resolves.toMatchObject({
      moved: { chats: 2, wallets: 1 },
    });
  });
});
