import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountOverviewFixture } from "@/test/account-overview-fixture";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { AgentWalletsSection } from "./agent-wallets-section";

const commit = vi.hoisted(() => ({
  approve: vi.fn(async () => undefined),
  refs: [] as string[],
  state: "awaiting_approval",
}));
vi.mock("@aomi-labs/client", async (original) => ({
  ...(await original<typeof import("@aomi-labs/client")>()),
  AomiCommits: class {
    async get(ref: string) {
      commit.refs.push(ref);
      const view = () => ({
        state: commit.state,
        transaction_url: "https://basescan.org/tx/0x1",
      });
      return {
        ref,
        approve: async () => {
          await commit.approve();
          commit.state = "confirmed";
        },
        refresh: async () => view(),
        subscribe: () => () => undefined,
        close: () => undefined,
        get view() {
          return view();
        },
      };
    }
  },
}));

const EVM = "0xae86000000000000000000000000000000009738";
const SVM = "B4KZ1111111111111111111111111111111UJVo";

const wallet = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  paused: false,
  archived_at: null,
  app: null,
  last_used_at: null,
  created_at: 1_760_000_000,
  addresses: [],
  connections: [],
  ...extra,
});
const trading = wallet("g-trading", "Trading", {
  last_used_at: 1_760_000_500,
  addresses: [
    { family: "evm", address: EVM, wallet_id: "w_12" },
    { family: "svm", address: SVM, wallet_id: "w_13" },
  ],
  connections: [
    { key: "oauth:c1", label: "Claude Code", instant: false },
    { key: "portal", label: "Aomi", instant: true },
  ],
});
const world = wallet("g-world", "World", {
  app: { id: 90, name: "world", label: "World" },
});
const hoodit = wallet("g-hoodit", "Hoodit", {
  paused: true,
  app: { id: 86, name: "hoodit", label: "Hoodit" },
});
const extra = wallet("g-extra", "Extra");
const old = wallet("g-old", "Old", { archived_at: 1_760_000_100 });

const agentRow = (address: string, id: string, active = false): WalletRow =>
  ({
    key: `${address.startsWith("0x") ? "evm" : "svm"}:${address}`,
    family: address.startsWith("0x") ? "evm" : "svm",
    address,
    kind: "agent",
    state: "ready",
    label: "Trading",
    linkedWalletId: id,
    linked: true,
    connected: false,
    operating: active,
    active,
    pendingStep: null,
    actions: [],
  }) as WalletRow;
const rows = [agentRow(EVM, "12"), agentRow(SVM, "13", true)];

let list: { pause_all: boolean; version: number; wallets: object[] };
let calls: { method: string; path: string; body: unknown }[] = [];
let respond: (method: string, path: string) => Response | undefined;
beforeEach(() => {
  calls = [];
  commit.state = "awaiting_approval";
  commit.refs = [];
  commit.approve.mockReset();
  respond = () => undefined;
  list = {
    pause_all: false,
    version: 4,
    wallets: [trading, world, hoodit, extra, old],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://portal.test");
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: `${url.pathname}${url.search}`,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const answer = respond(method, url.pathname);
      if (answer) return answer;
      if (url.pathname === "/v1/account/agent-wallets")
        return Response.json(list);
      if (url.pathname.endsWith("/balances"))
        return Response.json({ networks: [] });
      if (method === "PATCH") return Response.json(trading);
      return Response.json({ locked: true, version: 5 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function renderSection(onUse = vi.fn()) {
  await act(async () => {
    render(
      <div>
        <AgentWalletsSection rows={rows} pending={null} onUse={onUse} />
      </div>,
      { wrapper: AccountOverviewFixture },
    );
  });
  await screen.findByRole("button", { name: "Actions for Trading" });
  return onUse;
}
const parent = (id: string) =>
  document.querySelector(`[data-agent-wallet="${id}"]`) as HTMLElement;
const menuOf = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  return screen.getByRole("menu", { name: `Actions for ${name}` });
};
const names = (menu: HTMLElement) =>
  Array.from(menu.querySelectorAll('[role^="menuitem"]')).map(
    (item) => item.querySelector("span")?.textContent,
  );
const writes = () => calls.filter((call) => call.method !== "GET");

describe("Agent wallets band", () => {
  it("shows the three most recent with chips, today's EVM/SVM rows under the active one, then Show all and Archived", async () => {
    await renderSection();
    expect(
      screen.getByText(
        "Hosted by Aomi · it signs when a connection is allowed to",
      ),
    ).toBeInTheDocument();
    const shown = Array.from(
      document.querySelectorAll("[data-agent-wallet]"),
    ).map((node) => node.getAttribute("data-agent-wallet"));
    expect(shown).toEqual(["g-trading", "g-world", "g-hoodit"]);
    expect(within(parent("g-trading")).getByText(/1 connection$/)).toBeTruthy();
    expect(within(parent("g-world")).getByText("used by World")).toBeTruthy();
    expect(within(parent("g-hoodit")).getByText("Paused")).toBeTruthy();
    // The active wallet starts open, its SVM child row striped Active.
    const active = parent("g-trading").querySelector("[data-active]")!;
    expect(active).toHaveTextContent("Trading");
    expect(within(active as HTMLElement).getByText("Active")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show all 4 agent wallets" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Old")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(parent("g-old")).toHaveTextContent("Archived · 0 connections");
    for (const gone of ["$", "Export", "Use for an app", "Lock"])
      expect(screen.queryByText(gone)).toBeNull();
  });

  it("offers Details, Use in chats, Withdraw, Rename, Pause and Archive; Restore when archived", async () => {
    const onUse = await renderSection();
    expect(names(menuOf("World"))).toEqual([
      "Details",
      "Withdraw…",
      "Rename",
      "Pause",
      "Archive",
    ]);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    const tradingMenu = menuOf("Trading");
    expect(names(tradingMenu)).toEqual([
      "Details",
      "Use in chats",
      "Withdraw…",
      "Rename",
      "Pause",
      "Archive",
    ]);
    fireEvent.click(within(tradingMenu).getByText("Use in chats"));
    expect(onUse).toHaveBeenCalledWith([rows[0]]);
    expect(names(menuOf("Hoodit"))).toContain("Resume");
    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(names(menuOf("Old"))).toEqual(["Details", "Withdraw…", "Restore"]);
  });

  it("pauses one wallet, and pauses all from the band at the version read", async () => {
    await renderSection();
    const pause = within(menuOf("World")).getByText("Pause");
    await act(async () => fireEvent.click(pause));
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: "/v1/account/agent-wallets/g-world",
        body: { paused: true },
      },
    ]);
    const pauseAll = within(menuOf("agent wallets")).getByText("Pause all");
    await act(async () => fireEvent.click(pauseAll));
    expect(writes().at(-1)).toEqual({
      method: "PUT",
      path: "/v1/account/agent-rule",
      body: { locked: true, version: 4 },
    });
  });

  it("renames inline", async () => {
    await renderSection();
    fireEvent.click(within(menuOf("World")).getByText("Rename"));
    const input = screen.getByRole("textbox", { name: "Name for World" });
    fireEvent.change(input, { target: { value: "  Markets " } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: "/v1/account/agent-wallets/g-world",
        body: { name: "Markets" },
      },
    ]);
  });

  it("offers Withdraw first when archiving a funded wallet, and explains a busy one", async () => {
    respond = (method, path) =>
      path.endsWith("/balances")
        ? Response.json({
            networks: [
              {
                chain_id: 8453,
                name: "Base",
                usd_total: "1.00",
                assets: [
                  {
                    token: "native",
                    symbol: "ETH",
                    decimals: 18,
                    amount: "0.001",
                    usd: "1.00",
                  },
                ],
              },
            ],
          })
        : method === "PATCH"
          ? Response.json({ error: "agent_wallet_busy" }, { status: 409 })
          : undefined;
    await renderSection();
    const archive = within(menuOf("Trading")).getByText("Archive");
    await act(async () => fireEvent.click(archive));
    const dialog = await screen.findByRole("alertdialog", {
      name: 'Archive "Trading"?',
    });
    expect(dialog).toHaveTextContent("It still holds funds.");
    expect(
      within(dialog).getByRole("button", { name: "Withdraw first" }),
    ).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Archive" })),
    );
    expect(writes().at(-1)).toMatchObject({ body: { archived: true } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A trade from this wallet is still in flight.",
    );
  });

  it("shows details: QR, the address, its networks and who can use it", async () => {
    await renderSection();
    fireEvent.click(within(menuOf("Trading")).getByText("Details"));
    const sheet = await screen.findByRole("dialog");
    expect(
      within(sheet).getByRole("img", { name: `QR code for ${EVM}` }),
    ).toBeInTheDocument();
    expect(sheet).toHaveTextContent(EVM);
    for (const network of ["Ethereum", "Base", "Robinhood Chain", "Arc"])
      expect(within(sheet).getByText(network)).toBeInTheDocument();
    expect(within(sheet).queryByText("Sepolia")).toBeNull();
    expect(within(sheet).getByText("Claude Code")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Solana" }));
    expect(sheet).toHaveTextContent(SVM);
    expect(within(sheet).queryByText("Base")).toBeNull();
  });

  it("withdraws in three steps and approves the commit on the spot", async () => {
    const own = {
      ...rows[0]!,
      key: "evm:0x80c4",
      kind: "external",
      address: "0x80c400000000000000000000000000000000293a",
      label: undefined,
      brand: "MetaMask",
      linkedWalletId: "9",
    } as WalletRow;
    respond = (method, path) =>
      path.endsWith("/balances")
        ? Response.json({
            networks: [
              {
                chain_id: 8453,
                name: "Base",
                usd_total: "412.18",
                assets: [
                  {
                    token: "0xusdc",
                    symbol: "USDC",
                    decimals: 6,
                    amount: "312.40",
                    usd: "312.40",
                  },
                  {
                    token: "native",
                    symbol: "ETH",
                    decimals: 18,
                    amount: "0.0312",
                    usd: "99.78",
                  },
                ],
              },
              { chain_id: 1, name: "Ethereum", assets: [] },
            ],
          })
        : path.endsWith("/withdraw")
          ? Response.json({ ref: "c_1" })
          : undefined;
    await act(async () => {
      render(<AgentWalletsSection rows={[...rows, own]} pending={null} />, {
        wrapper: AccountOverviewFixture,
      });
    });
    fireEvent.click(
      within(
        await screen
          .findByRole("button", { name: "Actions for Trading" })
          .then(() => menuOf("Trading")),
      ).getByText("Withdraw…"),
    );
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("1 more network")).toBeInTheDocument();
    fireEvent.click(await within(sheet).findByText("Base"));
    expect(sheet).toHaveTextContent("Step 2 of 3");
    fireEvent.click(
      within(sheet).getByRole("checkbox", { name: "Withdraw USDC" }),
    );
    fireEvent.change(
      within(sheet).getByRole("textbox", { name: "USDC amount" }),
      {
        target: { value: "500" },
      },
    );
    expect(within(sheet).getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.change(
      within(sheet).getByRole("textbox", { name: "USDC amount" }),
      {
        target: { value: "312.4" },
      },
    );
    fireEvent.click(
      within(sheet).getByRole("checkbox", { name: "Withdraw ETH" }),
    );
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Max" })[1]!);
    expect(sheet).toHaveTextContent("Max keeps enough of the native token");
    fireEvent.click(within(sheet).getByRole("button", { name: "Next" }));
    expect(
      within(sheet).getByRole("radio", { name: /MetaMask/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(sheet).toHaveTextContent("2 transfers on Base");
    await act(async () =>
      fireEvent.click(within(sheet).getByRole("button", { name: "Withdraw" })),
    );
    expect(writes().at(-1)).toEqual({
      method: "POST",
      path: "/v1/account/agent-wallets/g-trading/withdraw",
      body: {
        family: "evm",
        chain_id: 8453,
        to: own.address,
        assets: [
          { token: "0xusdc", amount: "312.4" },
          { token: "native", amount: "max" },
        ],
      },
    });
    expect(commit.refs).toEqual(["c_1"]);
    expect(commit.approve).toHaveBeenCalledOnce();
    expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
  });

  it("after an ambiguous failure, retries the same withdrawal and never posts another", async () => {
    respond = (method, path) =>
      path.endsWith("/balances")
        ? Response.json({
            networks: [
              {
                chain_id: "solana",
                name: "Solana",
                usd_total: "5.00",
                assets: [
                  {
                    token: "native",
                    symbol: "SOL",
                    decimals: 9,
                    amount: "0.03",
                    usd: "5.00",
                  },
                ],
              },
            ],
          })
        : path.endsWith("/withdraw")
          ? Response.json({ ref: "c_2" })
          : undefined;
    commit.approve.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await renderSection();
    fireEvent.click(within(menuOf("Trading")).getByText("Withdraw…"));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("radio", { name: "Solana" }));
    fireEvent.click(
      await within(sheet).findByRole("button", { name: /Solana.*1 asset/ }),
    );
    fireEvent.click(
      within(sheet).getByRole("checkbox", { name: "Withdraw SOL" }),
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Max" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Next" }));
    fireEvent.change(
      within(sheet).getByRole("textbox", { name: "Destination address" }),
      { target: { value: SVM } },
    );
    await act(async () =>
      fireEvent.click(within(sheet).getByRole("button", { name: "Withdraw" })),
    );
    // Solana withdraws carry no chain id.
    expect(writes().at(-1)).toEqual({
      method: "POST",
      path: "/v1/account/agent-wallets/g-trading/withdraw",
      body: {
        family: "svm",
        to: SVM,
        assets: [{ token: "native", amount: "max" }],
      },
    });
    expect(
      await within(sheet).findByText(
        "The withdrawal is waiting for your approval. Try again to approve it.",
      ),
    ).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent("Nothing was sent");
    await act(async () =>
      fireEvent.click(within(sheet).getByRole("button", { name: "Try again" })),
    );
    expect(commit.approve).toHaveBeenCalledTimes(2);
    expect(
      writes().filter((call) => call.path.endsWith("/withdraw")),
    ).toHaveLength(1);
    expect(commit.refs).toEqual(["c_2"]);
    expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
  });
});
