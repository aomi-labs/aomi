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
    instant: false,
    last_used_at: null,
    connected_at: null,
    removable: false,
  },
  {
    key: "telegram:77",
    kind: "telegram",
    name: "@HooditBot",
    detail: "Telegram @arixon",
    instant: true,
    last_used_at: NOW / 1000 - 2 * 3600,
    connected_at: null,
    removable: true,
  },
  {
    key: "oauth:c1",
    kind: "ai",
    name: "Claude",
    detail: null,
    instant: false,
    last_used_at: NOW / 1000 - 30 * 3600,
    connected_at: 1,
    removable: true,
  },
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
        path === "/v1/account/connections" ? { connections } : {},
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
  it("lists each connection quietly: mark, name, Instant pill, kind and last use", async () => {
    await renderTab();
    expect(rowOf("portal")).toHaveTextContent("AomiThis website");
    expect(rowOf("telegram:77")).toHaveTextContent(
      "@HooditBotInstantTelegram @arixon · used 2 h ago",
    );
    expect(rowOf("oauth:c1")).toHaveTextContent(
      "ClaudeAI client · used yesterday",
    );
    expect(within(rowOf("oauth:c1")).queryByText("Instant")).toBeNull();
    expect(
      screen.queryByText("Use Aomi from Claude, your terminal or Telegram."),
    ).toBeNull();
  });

  it("offers Ask/Instant, Rename and Remove in the ⋯ menu, by kind", async () => {
    await renderTab();
    const names = (menu: HTMLElement) =>
      Array.from(menu.querySelectorAll('[role^="menuitem"]')).map(
        (item) => item.querySelector("span")?.textContent,
      );
    expect(names(menuOf("Aomi"))).toEqual([
      "Ask before each trade",
      "Trade without asking",
    ]);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    const claude = menuOf("Claude");
    expect(names(claude)).toEqual([
      "Ask before each trade",
      "Trade without asking",
      "Rename",
      "Remove",
    ]);
    expect(
      within(claude).getByRole("menuitemradio", { name: /Ask before/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("asks before turning Instant on, then writes it", async () => {
    await renderTab();
    fireEvent.click(
      within(menuOf("Claude")).getByRole("menuitemradio", {
        name: /Trade without asking/,
      }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Sign without asking?",
    });
    expect(dialog).toHaveTextContent(
      "Trades from Claude will sign without asking.",
    );
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" })),
    );
    expect(writes()).toEqual([
      {
        method: "PUT",
        path: "/v1/account/connection-settings/oauth%3Ac1",
        body: { instant: true },
      },
    ]);
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
