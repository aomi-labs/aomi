import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountOverviewFixture } from "@/test/account-overview-fixture";
import { ConnectionsSettings, usedLabel } from "./connections-settings";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const connections = [
  {
    key: "portal",
    kind: "portal",
    name: "Aomi",
    detail: null,
    telegram: null,
    application: null,
    ask_only: false,
    wallets: [],
    last_used_at: null,
    connected_at: null,
    removable: false,
  },
  {
    key: "telegram:77",
    kind: "telegram",
    name: "@HooditBot",
    detail: "Telegram @arixon",
    telegram: { user: "@arixon", bot: "@HooditBot" },
    application: { id: 86, name: "hoodit", label: "Hoodit" },
    ask_only: false,
    wallets: [
      { id: "g-hoodit", name: "Hoodit", lane: "instant", archived: false },
      // Archived: kept on every replace, never counted or shown.
      { id: "g-old", name: "Old", lane: "instant", archived: true },
    ],
    last_used_at: NOW / 1000 - 2 * 3600,
    connected_at: null,
    removable: true,
  },
  {
    // Renamed by the user, open to any app.
    key: "telegram:78",
    kind: "telegram",
    name: "Markets",
    detail: "Telegram @arixon",
    telegram: { user: "@arixon", bot: "@MarketsBot" },
    application: null,
    ask_only: false,
    wallets: [
      { id: "g-trading", name: "Trading", lane: "here", archived: false },
    ],
    last_used_at: null,
    connected_at: null,
    removable: true,
  },
  {
    key: "oauth:c1",
    kind: "ai",
    name: "Claude",
    detail: null,
    telegram: null,
    application: null,
    ask_only: true,
    wallets: [
      { id: "g-trading", name: "Trading", lane: "aomi", archived: false },
    ],
    last_used_at: NOW / 1000 - 30 * 3600,
    connected_at: 1,
    removable: true,
  },
];

const agentWallet = (
  id: string,
  name: string,
  connections: { key: string; label: string; lane: string }[] = [],
) => ({
  id,
  name,
  paused: false,
  archived_at: null,
  app: null,
  last_used_at: null,
  created_at: 1,
  addresses: [
    {
      family: "evm",
      address: "0xae86000000000000000000000000000000009738",
      wallet_id: "w_1",
    },
  ],
  connections,
});
const agentWallets = [
  agentWallet("g-trading", "Trading", [
    { key: "telegram:78", label: "Markets", lane: "here" },
    { key: "oauth:c1", label: "Claude", lane: "aomi" },
  ]),
  agentWallet("g-hoodit", "Hoodit", [
    { key: "telegram:77", label: "Hoodit", lane: "instant" },
  ]),
];

let calls: { method: string; path: string; body: unknown }[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "https://portal.test").pathname;
      calls.push({
        method: init?.method ?? "GET",
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(
        path === "/v1/account/connections"
          ? { connections }
          : path === "/v1/account/agent-wallets"
            ? { pause_all: false, wallets: agentWallets }
            : path === "/v1/account/wallets"
              ? { wallets: [] }
              : {},
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function renderTab() {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  await act(async () => {
    render(<ConnectionsSettings />, { wrapper: AccountOverviewFixture });
  });
  await screen.findByText("Claude");
}
const rowOf = (key: string) =>
  document.querySelector(`[data-connection="${key}"]`) as HTMLElement;
const menuOf = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  return screen.getByRole("menu", { name: `Actions for ${name}` });
};
const writes = () => calls.filter((call) => call.method !== "GET");

describe("Connections tab", () => {
  it("lists each connection quietly: mark, name, Instant lanes and last use", async () => {
    await renderTab();
    expect(rowOf("portal")).toHaveTextContent(
      "AomiThis website · all agent wallets",
    );
    // No Instant lane: no wallet count, just the last use.
    expect(rowOf("oauth:c1")).toHaveTextContent(
      "ClaudeAI client · used yesterday",
    );
    expect(rowOf("oauth:c1")).not.toHaveTextContent("wallet");
    expect(within(rowOf("oauth:c1")).queryByText("Instant")).toBeNull();
  });

  it("bands connections by kind and leaves out an empty band", async () => {
    await renderTab();
    const bands = [...document.querySelectorAll("[data-connection-band]")];
    expect(
      bands.map((band) => band.getAttribute("data-connection-band")),
    ).toEqual(["Websites", "Chat bots", "AI assistants"]);
    expect(bands[2]).toHaveTextContent(
      "Claude, Cursor, pi and other MCP clients",
    );
    expect(within(bands[2] as HTMLElement).getByText("Claude")).toBeTruthy();
    // Only the card's first band drops its top line (the card border is it).
    expect(bands.map((band) => band.className.includes("border-t-0"))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("groups Telegram bots under one Telegram row, each titled by its app or your name", async () => {
    await renderTab();
    const telegram = rowOf("telegram");
    expect(telegram).toHaveTextContent(
      "Telegram@arixon · 2 bots · Instant on 1 wallet",
    );
    const toggle = within(telegram).getByRole("button", {
      name: "Hide Telegram bots",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The bot is titled by its app, its @handle below; no Instant pill.
    expect(rowOf("telegram:77")).toHaveTextContent(
      "Hoodit@HooditBot · Instant on 1 wallet · used 2 h ago",
    );
    expect(within(rowOf("telegram:77")).queryByText("Instant")).toBeNull();
    expect(within(rowOf("telegram:77")).getAllByText("Hoodit")).toHaveLength(1);
    // A bot you renamed keeps your name.
    expect(rowOf("telegram:78")).toHaveTextContent("Markets@MarketsBot");
    expect(rowOf("telegram:78")).not.toHaveTextContent("Instant");
    fireEvent.click(toggle);
    expect(rowOf("telegram:77")).toBeNull();
    expect(
      within(telegram).getByRole("button", { name: "Show Telegram bots" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("offers Manage, Rename and Disconnect in the ⋯ menu, never Ask/Instant", async () => {
    await renderTab();
    const names = (menu: HTMLElement) =>
      Array.from(menu.querySelectorAll('[role^="menuitem"]')).map(
        (item) => item.textContent,
      );
    const close = () =>
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    expect(names(menuOf("Aomi"))).toEqual(["Manage"]);
    close();
    const claude = menuOf("Claude");
    expect(names(claude)).toEqual(["Manage", "Rename", "Disconnect"]);
    // Disconnect is destructive: last, after a separator.
    expect(claude.lastElementChild?.previousElementSibling).toHaveAttribute(
      "role",
      "separator",
    );
    close();
    // A bot is disconnected with Telegram as a whole.
    expect(names(menuOf("@HooditBot"))).toEqual(["Manage", "Rename"]);
    close();
    expect(names(menuOf("Telegram"))).toEqual([
      "Manage",
      "Disconnect Telegram",
    ]);
  });

  it("edits one connection's lanes in its Manage sheet", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("@HooditBot")).getByText("Manage"));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Hoodit@HooditBot · Telegram bot");
    expect(
      await within(sheet).findByText("Wallets it can use"),
    ).toBeInTheDocument();
    // No Approvals switch: the lane is the whole choice.
    expect(within(sheet).queryByRole("switch")).toBeNull();
    expect(
      within(sheet).getByRole("combobox", { name: "Hoodit: Instant" }),
    ).toBeInTheDocument();
    // A wallet the bot has no row on uses its default: Ask in the bot.
    const trading = within(sheet).getByRole("combobox", {
      name: "Trading: Ask in Hoodit",
    });
    fireEvent.click(trading);
    expect(
      screen.getByRole("button", { name: /^Ask in Hoodit/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /^Ask on Aomi/ })),
    );
    expect(writes().at(-1)).toEqual({
      method: "PUT",
      path: "/v1/account/connections/telegram%3A77/wallets",
      body: {
        wallets: [
          { id: "g-hoodit", lane: "instant" },
          { id: "g-old", lane: "instant" },
          { id: "g-trading", lane: "aomi" },
        ],
      },
    });

    // Instant asks first.
    await waitFor(() => expect(trading).not.toBeDisabled());
    fireEvent.click(trading);
    fireEvent.click(screen.getByRole("button", { name: /^Instant/ }));
    const confirm = await screen.findByRole("alertdialog", {
      name: "Sign without asking?",
    });
    await act(async () =>
      fireEvent.click(within(confirm).getByRole("button", { name: "Turn on" })),
    );
    expect(writes().at(-1)).toMatchObject({
      method: "PUT",
      body: {
        wallets: [
          { id: "g-hoodit", lane: "instant" },
          { id: "g-old", lane: "instant" },
          { id: "g-trading", lane: "instant" },
        ],
      },
    });
  });

  it("locks an Ask-only connection at Ask on Aomi", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("Claude")).getByText("Manage"));
    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText(/asks before every trade/),
    ).toBeInTheDocument();
    expect(await within(sheet).findAllByText("Ask on Aomi")).toHaveLength(2);
    expect(within(sheet).queryByRole("combobox")).toBeNull();
  });

  it("renames in a dialog and disconnects an OAuth client after a confirm", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("Claude")).getByText("Rename"));
    const rename = await screen.findByRole("dialog", {
      name: "Rename connection",
    });
    const input = within(rename).getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("Claude");
    fireEvent.change(input, { target: { value: "  Laptop  " } });
    await act(async () => fireEvent.submit(input));
    expect(writes().at(-1)).toMatchObject({ body: { label: "Laptop" } });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Rename connection" }),
      ).toBeNull(),
    );

    fireEvent.click(within(menuOf("Claude")).getByText("Disconnect"));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Disconnect Claude?",
    });
    expect(dialog).toHaveTextContent("has to connect again");
    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Disconnect" }),
      ),
    );
    expect(writes().at(-1)).toMatchObject({
      method: "DELETE",
      path: "/v1/account/connections/oauth/c1",
    });
  });

  it("offers Rename and Disconnect as rows in the Manage sheet", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("Claude")).getByText("Manage"));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Rename" }));
    expect(
      screen.getByRole("dialog", { name: "Rename connection" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(menuOf("Claude")).getByText("Manage"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );
    expect(
      await screen.findByRole("alertdialog", { name: "Disconnect Claude?" }),
    ).toBeInTheDocument();
  });

  it("disconnects Telegram after a confirm", async () => {
    await renderTab();
    fireEvent.click(
      within(menuOf("Telegram")).getByText("Disconnect Telegram"),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Disconnect Telegram?",
    });
    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Disconnect" }),
      ),
    );
    expect(writes().at(-1)).toMatchObject({
      method: "DELETE",
      path: "/v1/account/connections/telegram",
    });
  });
});

describe("usedLabel", () => {
  it("reads like the list", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(usedLabel(now / 1000 - 20, now)).toBe("used just now");
    expect(usedLabel(now / 1000 - 600, now)).toBe("used 10 min ago");
    expect(usedLabel(now / 1000 - 3 * 86_400, now)).toBe("used Oct 13");
  });
});
