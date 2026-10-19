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
    ceiling: null,
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
    ceiling: null,
    wallets: [
      { id: "g-hoodit", name: "Hoodit", instant: true, archived: false },
      // Archived: kept on every replace, never counted or shown.
      { id: "g-old", name: "Old", instant: true, archived: true },
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
    ceiling: null,
    wallets: [
      { id: "g-trading", name: "Trading", instant: false, archived: false },
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
    ceiling: "ask",
    wallets: [
      { id: "g-trading", name: "Trading", instant: false, archived: false },
    ],
    last_used_at: NOW / 1000 - 30 * 3600,
    connected_at: 1,
    removable: true,
  },
];

const agentWallet = (id: string, name: string) => ({
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
  connections: [],
});
const agentWallets = [
  agentWallet("g-trading", "Trading"),
  agentWallet("g-hoodit", "Hoodit"),
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
            ? { pause_all: false, version: 1, wallets: agentWallets }
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
  it("lists each connection quietly: mark, name, Instant pill, wallets and last use", async () => {
    await renderTab();
    expect(rowOf("portal")).toHaveTextContent(
      "AomiThis website · all agent wallets",
    );
    expect(rowOf("oauth:c1")).toHaveTextContent(
      "ClaudeAI client · 1 wallet · used yesterday",
    );
    expect(within(rowOf("oauth:c1")).queryByText("Instant")).toBeNull();
  });

  it("groups Telegram bots under one Telegram row, each titled by its app or your name", async () => {
    await renderTab();
    const telegram = rowOf("telegram");
    expect(telegram).toHaveTextContent("Telegram@arixon · 2 bots · 2 wallets");
    const toggle = within(telegram).getByRole("button", {
      name: "Hide Telegram bots",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The bot is titled by its app, its @handle below; no app pill.
    expect(rowOf("telegram:77")).toHaveTextContent(
      "HooditInstant@HooditBot · 1 wallet · used 2 h ago",
    );
    expect(within(rowOf("telegram:77")).getAllByText("Hoodit")).toHaveLength(1);
    // A bot you renamed keeps your name.
    expect(rowOf("telegram:78")).toHaveTextContent(
      "Markets@MarketsBot · 1 wallet",
    );
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

  it("edits one connection's wallets in its Manage sheet", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("@HooditBot")).getByText("Manage"));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent(
      "Hoodit@HooditBot · Telegram bot · locked to Hoodit",
    );
    expect(within(sheet).getByText("Wallets it can use")).toBeInTheDocument();
    const trading = await within(sheet).findByRole("checkbox", {
      name: "Allow Trading",
    });
    expect(trading).toHaveAttribute("aria-checked", "false");
    await act(async () => fireEvent.click(trading));
    expect(writes().at(-1)).toEqual({
      method: "PUT",
      path: "/v1/account/connections/telegram%3A77/wallets",
      body: {
        wallets: [
          { id: "g-hoodit", instant: true },
          { id: "g-old", instant: true },
          { id: "g-trading", instant: false },
        ],
      },
    });
  });

  it("greys out Instant under a ceiling", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("Claude")).getByText("Manage"));
    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText(/asks before every trade/),
    ).toBeInTheDocument();
    const modes = within(sheet).getByRole("radiogroup", {
      name: "Trading mode",
    });
    expect(
      within(modes).getByRole("radio", { name: "Instant" }),
    ).toBeDisabled();
  });

  it("renames in a dialog and disconnects an OAuth client after a confirm", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("Claude")).getByText("Rename"));
    const rename = await screen.findByRole("dialog", { name: "Rename connection" });
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
