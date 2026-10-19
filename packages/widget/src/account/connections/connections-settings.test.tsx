import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
    key: "oauth:c1",
    kind: "ai",
    name: "Claude",
    detail: null,
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
  it("lists each connection quietly: mark, name, app badge, Instant pill, wallets and last use", async () => {
    await renderTab();
    expect(rowOf("portal")).toHaveTextContent("AomiThis website");
    expect(rowOf("telegram:77")).toHaveTextContent(
      "@HooditBotHooditInstantTelegram @arixon · 1 wallet · used 2 h ago",
    );
    expect(rowOf("oauth:c1")).toHaveTextContent(
      "ClaudeAI client · 1 wallet · used yesterday",
    );
    expect(within(rowOf("oauth:c1")).queryByText("Instant")).toBeNull();
  });

  it("offers Wallets…, Rename and Remove in the ⋯ menu, never Ask/Instant", async () => {
    await renderTab();
    const names = (menu: HTMLElement) =>
      Array.from(menu.querySelectorAll('[role^="menuitem"]')).map(
        (item) => item.querySelector("span")?.textContent,
      );
    expect(names(menuOf("Aomi"))).toEqual(["Wallets…"]);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(names(menuOf("Claude"))).toEqual(["Wallets…", "Rename", "Remove"]);
  });

  it("edits one connection's wallets in the Wallets… sheet, Instant only after a confirm", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("@HooditBot")).getByText("Wallets…"));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Telegram @arixon · locked to Hoodit");
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
    fireEvent.click(within(menuOf("Claude")).getByText("Wallets…"));
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

  it("renames inline and removes an OAuth client after a confirm", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("Claude")).getByText("Rename"));
    const input = screen.getByRole("textbox", { name: "Name for Claude" });
    fireEvent.change(input, { target: { value: "  Laptop  " } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(writes().at(-1)).toMatchObject({ body: { label: "Laptop" } });

    fireEvent.click(within(menuOf("Claude")).getByText("Remove"));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Remove Claude?",
    });
    expect(dialog).toHaveTextContent("It has to connect again.");
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove" })),
    );
    expect(writes().at(-1)).toMatchObject({
      method: "DELETE",
      path: "/v1/account/connections/oauth/c1",
    });
  });

  it("unlinks Telegram after a confirm", async () => {
    await renderTab();
    fireEvent.click(within(menuOf("@HooditBot")).getByText("Unlink Telegram"));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Unlink Telegram?",
    });
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" })),
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
