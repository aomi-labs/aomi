import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AomiClient } from "@aomi-labs/client";
import { TelegramLinkPanel } from "./telegram-link-panel";

const code = "Ab0_-".repeat(8) + "xyz";

const preview = {
  telegram: {
    username: "arixon",
    bots: [{ bot_id: "7712345678", label: "@HooditBot" }],
    linked_from: { bot_id: "7712345678", label: "@HooditBot" },
  },
  account: { label: "arixon.ethereum@gmail.com" },
  survivor: "this_account",
  moves: {
    agent_wallets: [
      {
        id: "w_31",
        family: "evm",
        address: "0x7a3f…c41e",
        label: "Agent wallet",
        total_usd: "95.10",
        becomes: "extra",
      },
    ],
    chats_in_bots: 3,
    scheduled_jobs: 1,
    pending_trades: { cancel: 1, wait: 0 },
    world: [{ bot: "@WorldMarketsBot", state: "active" }],
  },
  expires_at: 1_760_401_000,
};

const linked = {
  linked: true,
  telegram: { username: "arixon" },
  wallets: [
    { id: "w_12", address: "0x91c0…", role: "default" },
    { id: "w_31", address: "0x7a3f…", role: "extra" },
  ],
  cancelled: 1,
  moved: { chats: 3, wallets: 2 },
};

type Route = () => Response | Promise<Response>;

function backend(routes: Record<string, Route | Route[]>) {
  const calls: { path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[url.pathname.split("/").pop()!];
    const handler = Array.isArray(route) ? route.shift() : route;
    return handler
      ? handler()
      : Response.json({ error: "unexpected" }, { status: 500 });
  }) as typeof globalThis.fetch;
  const client = new AomiClient({
    baseUrl: "https://portal.test",
    guest: false,
    fetch,
  });
  return { client, calls };
}

const onClose = vi.fn();
const refuse = (status: number, body: Record<string, unknown>) => () =>
  Response.json(body, { status });

async function renderPanel(
  routes: Record<string, Route | Route[]>,
  panelCode: string | null = code,
) {
  const { client, calls } = backend(routes);
  await act(async () => {
    render(
      <TelegramLinkPanel client={client} code={panelCode} onClose={onClose} />,
    );
  });
  return calls;
}

const click = (name: string) =>
  act(async () => fireEvent.click(screen.getByRole("button", { name })));

afterEach(() => vi.useRealTimers());

describe("TelegramLinkPanel", () => {
  it("asks to link with the account and what linking changes", async () => {
    const calls = await renderPanel({ preview: () => Response.json(preview) });
    expect(calls).toEqual([
      { path: "/v1/account/link/telegram/preview", body: { code } },
    ]);
    expect(
      screen.getByRole("heading", { name: "Link Telegram @arixon?" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Aomi bots will use this account and its agent wallet."),
    ).toBeTruthy();
    expect(screen.getByText("arixon.ethereum@gmail.com")).toBeTruthy();
    for (const line of [
      "The Telegram agent wallet joins this account",
      "Chats stay in the bot; 1 scheduled task moves here",
      "1 trade waiting for approval will be cancelled. Nothing was signed.",
    ])
      expect(screen.getByText(line)).toBeTruthy();
    expect(
      screen.getByText(
        "Only continue if @arixon is you. You can unlink it later in Settings › Connections.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link" })).toBeTruthy();
  });

  it("leaves out lines that change nothing", async () => {
    await renderPanel({
      preview: () =>
        Response.json({
          ...preview,
          moves: {
            agent_wallets: [],
            chats_in_bots: 0,
            scheduled_jobs: 0,
            pending_trades: { cancel: 0, wait: 0 },
            world: [],
          },
        }),
    });
    expect(screen.getByText("Chats stay in the bot")).toBeTruthy();
    expect(screen.queryByText(/agent wallet joins/)).toBeNull();
    expect(screen.queryByText(/will be cancelled/)).toBeNull();
  });

  it("links on confirm and sends you back to the bot", async () => {
    const calls = await renderPanel({
      preview: () => Response.json(preview),
      confirm: () => Response.json(linked),
    });
    await click("Link");
    expect(calls.at(-1)).toEqual({
      path: "/v1/account/link/telegram/confirm",
      body: { code },
    });
    expect(screen.getByRole("heading", { name: "Linked" })).toBeTruthy();
    expect(screen.getByText("@HooditBot now uses this account.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Back to @HooditBot" })
        .getAttribute("href"),
    ).toBe("https://t.me/HooditBot");
  });

  it("says it is finishing trades when linking takes a while", async () => {
    let finish: (response: Response) => void = () => undefined;
    await renderPanel({
      preview: () => Response.json(preview),
      confirm: () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    vi.useFakeTimers();
    await click("Link");
    expect(
      (screen.getByRole("button", { name: "Linking…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(screen.getByText("Finishing trades in progress…")).toBeTruthy();
    vi.useRealTimers();
    await act(async () => finish(Response.json(linked)));
    expect(await screen.findByRole("heading", { name: "Linked" })).toBeTruthy();
  });

  it("cancels the code and says nothing was linked", async () => {
    const calls = await renderPanel({
      preview: () => Response.json(preview),
      cancel: () => Response.json({ cancelled: true }),
    });
    await click("Cancel");
    expect(calls.at(-1)).toEqual({
      path: "/v1/account/link/telegram/cancel",
      body: { code },
    });
    expect(screen.getByRole("heading", { name: "Not linked" })).toBeTruthy();
  });

  it.each([
    [
      410,
      { error: "link_code_expired" },
      "This link expired. Send /link in the bot again.",
    ],
    [
      410,
      { error: "link_code_used" },
      "This link was already used or isn't valid.",
    ],
    [
      410,
      { error: "link_code_invalid" },
      "This link was already used or isn't valid.",
    ],
    [
      409,
      { error: "telegram_already_linked" },
      "This Telegram is already linked.",
    ],
    [
      409,
      { error: "telegram_already_linked", same_account: true },
      "This Telegram is already linked to this account.",
    ],
    [
      409,
      { error: "account_has_other_telegram" },
      "This account already has a different Telegram linked.",
    ],
    [
      409,
      { error: "account_link_conflict", reason: "world_handover" },
      "Both accounts are connected to the same World Markets bot. Revoke one in World first.",
    ],
    [409, { error: "link_in_progress" }, "Linking is already in progress."],
    [
      409,
      { error: "account_merge_in_progress" },
      "Linking is already in progress.",
    ],
  ] as const)("explains a %i %j from preview", async (status, body, copy) => {
    await renderPanel({ preview: refuse(status, body) });
    expect(screen.getByRole("heading", { name: copy })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("explains a busy link with the trades in flight, and tries again", async () => {
    const calls = await renderPanel({
      preview: () => Response.json(preview),
      confirm: [
        refuse(409, {
          error: "account_link_busy",
          in_flight: [
            {
              id: "c-1",
              state: "submitted",
              chain: "8453",
              transaction_url: null,
            },
          ],
        }),
        () => Response.json(linked),
      ],
    });
    await click("Link");
    expect(
      screen.getByRole("heading", {
        name: "A trade from your Telegram account is still being sent. Try again in a minute.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("1 trade still being sent.")).toBeTruthy();
    await click("Try again");
    expect(calls.map((call) => call.path.split("/").pop())).toEqual([
      "preview",
      "confirm",
      "confirm",
    ]);
    expect(screen.getByRole("heading", { name: "Linked" })).toBeTruthy();
  });

  it("reloads the preview after a failure to reach Aomi", async () => {
    const calls = await renderPanel({
      preview: [
        () => Promise.reject(new TypeError("network down")),
        () => Response.json(preview),
      ],
    });
    expect(screen.getByText("Couldn’t reach Aomi. Try again.")).toBeTruthy();
    await click("Try again");
    expect(calls).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Link" })).toBeTruthy();
  });

  it("shows a malformed code as invalid without asking the server", async () => {
    const calls = await renderPanel({}, null);
    expect(calls).toEqual([]);
    expect(
      screen.getByText("This link was already used or isn't valid."),
    ).toBeTruthy();
  });
});
