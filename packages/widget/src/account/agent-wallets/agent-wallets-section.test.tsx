import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shortAddress } from "@aomi-labs/client";
import { AccountOverviewFixture } from "@/test/account-overview-fixture";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { AgentWalletsSection } from "./agent-wallets-section";

const commit = vi.hoisted(() => ({
  approve: vi.fn(async () => undefined),
  refs: [] as string[],
  state: "awaiting_approval",
  /** A second transfer in the batch, or null for a single commit. */
  second: null as string | null,
  listeners: new Set<() => void>(),
}));
vi.mock("@aomi-labs/client", async (original) => ({
  ...(await original<typeof import("@aomi-labs/client")>()),
  AomiCommits: class {
    async get(ref: string) {
      commit.refs.push(ref);
      const member = (commit_id: string, state: string) => ({
        commit_id,
        state,
        transaction_url: `https://basescan.org/tx/${commit_id}`,
      });
      const batch = () => [
        member(ref, commit.state),
        ...(commit.second === null ? [] : [member(`${ref}-2`, commit.second)]),
      ];
      const terminal = (state: string) =>
        ["confirmed", "failed", "rejected", "expired"].includes(state);
      return {
        ref,
        approve: async () => {
          await commit.approve();
          commit.state = "confirmed";
        },
        refresh: async () => batch()[0],
        subscribe: (listener: () => void) => {
          commit.listeners.add(listener);
          return () => commit.listeners.delete(listener);
        },
        close: () => undefined,
        get view() {
          return batch()[0];
        },
        get batch() {
          return batch();
        },
        get settled() {
          const all = batch();
          const done = all.every((view) => terminal(view.state));
          const failed = done
            ? all.find((view) => view.state !== "confirmed")
            : undefined;
          return { done, confirmed: done && !failed, failed, last: all.at(-1) };
        },
      };
    }
  },
}));

const EVM = "0xae86000000000000000000000000000000009738";
const SVM = "B4KZ1111111111111111111111111111111UJVo";
const SOLO = "0x5010000000000000000000000000000000000c0d";

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
    { key: "oauth:c1", label: "Claude Code", lane: "aomi" },
    { key: "portal", label: "Aomi", lane: "instant" },
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
const connection = (key: string, kind: string, name: string, extra = {}) => ({
  key,
  kind,
  name,
  detail: null,
  telegram: null,
  application: null,
  ask_only: false,
  wallets: [],
  last_used_at: null,
  connected_at: null,
  removable: kind !== "portal",
  ...extra,
});
const connections = [
  connection("portal", "portal", "Aomi", {
    wallets: [
      { id: "g-trading", name: "Trading", lane: "instant", archived: false },
    ],
  }),
  connection("oauth:c1", "ai", "Claude Code", {
    detail: "AI client",
    wallets: [
      { id: "g-trading", name: "Trading", lane: "aomi", archived: false },
    ],
  }),
];

const agentRow = (
  address: string,
  id: string,
  active = false,
  label = "Trading",
): WalletRow =>
  ({
    key: `${address.startsWith("0x") ? "evm" : "svm"}:${address}`,
    family: address.startsWith("0x") ? "evm" : "svm",
    address,
    kind: "agent",
    state: "ready",
    label,
    linkedWalletId: id,
    linked: true,
    connected: false,
    operating: active,
    active,
    pendingStep: null,
    actions: [],
  }) as WalletRow;
const rows = [agentRow(EVM, "12"), agentRow(SVM, "13", true)];

let list: { pause_all: boolean; wallets: object[] };
let calls: { method: string; path: string; body: unknown }[] = [];
let respond: (method: string, path: string) => Response | undefined;
beforeEach(() => {
  calls = [];
  commit.state = "awaiting_approval";
  commit.second = null;
  commit.listeners.clear();
  commit.refs = [];
  commit.approve.mockReset();
  respond = () => undefined;
  list = {
    pause_all: false,
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
      if (url.pathname === "/v1/account/connections")
        return Response.json({ connections });
      if (url.pathname.endsWith("/balances"))
        return Response.json({ networks: [] });
      if (method === "PATCH") return Response.json(trading);
      return Response.json({ pause_all: false });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function renderSection(walletRows = rows) {
  await act(async () => {
    render(
      <div>
        <AgentWalletsSection rows={walletRows} pending={null} />
      </div>,
      { wrapper: AccountOverviewFixture },
    );
  });
  await screen.findByRole("button", { name: "Actions for Trading" });
}
const parent = (id: string) =>
  document.querySelector(`[data-agent-wallet="${id}"]`) as HTMLElement;
const menuOf = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  return screen.getByRole("menu", { name: `Actions for ${name}` });
};
const names = (menu: HTMLElement) =>
  Array.from(menu.querySelectorAll('[role^="menuitem"]')).map(
    (item) => item.textContent,
  );
/** Opens a wallet's Manage sheet from its ⋯ menu. */
const manage = async (name: string) => {
  fireEvent.click(within(menuOf(name)).getByText("Manage"));
  return screen.findByRole("dialog");
};
const writes = () => calls.filter((call) => call.method !== "GET");

describe("Agent wallets band", () => {
  it("shows the three most recent without app labels, the EVM/SVM rows under the active one, then Show all and Archived", async () => {
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
    // Every parent reads "N addresses · EVM/SVM"; no connection count.
    expect(parent("g-trading")).toHaveTextContent("2 addresses · EVM/SVM");
    expect(parent("g-trading")).not.toHaveTextContent(/connection/);
    // Rows name no app; Paused sits at the row's end.
    expect(parent("g-world")).toHaveTextContent("0 addresses");
    expect(within(parent("g-world")).queryByText("used by World")).toBeNull();
    expect(within(parent("g-hoodit")).getByText("Paused")).toBeTruthy();
    // The active wallet starts open, its SVM child row striped Active.
    const toggle = within(parent("g-trading")).getByRole("button", {
      name: "Hide Trading addresses",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const active = parent("g-trading").querySelector("[data-active]")!;
    expect(active).toHaveTextContent("Trading");
    expect(within(active as HTMLElement).getByText("Active")).toBeTruthy();
    fireEvent.click(toggle);
    expect(parent("g-trading").querySelector("[data-wallet-row]")).toBeNull();
    // Wallets without addresses have nothing to expand.
    expect(
      within(parent("g-world")).queryByRole("button", {
        name: /^(Show|Hide) /,
      }),
    ).toBeNull();
    // The rest open in place, under the three; no sheet and no band menu.
    const all = screen.getByRole("button", {
      name: "Show all 4 agent wallets",
    });
    expect(all).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(all);
    expect(document.querySelectorAll("[data-agent-wallet]")).toHaveLength(4);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(document.querySelectorAll("[data-agent-wallet]")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Actions for agent wallets" }),
    ).toBeNull();
    expect(screen.queryByText("Pause all")).toBeNull();
    expect(screen.queryByText("Old")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(parent("g-old")).toHaveTextContent("0 addresses");
    for (const gone of ["$", "Export", "Use for an app", "Lock"])
      expect(screen.queryByText(gone)).toBeNull();
  });

  it("offers Manage, Rename, Pause and Archive; Restore when archived", async () => {
    await renderSection();
    const worldMenu = menuOf("World");
    expect(names(worldMenu)).toEqual(["Manage", "Rename", "Pause", "Archive"]);
    // Archive is destructive: last, after a separator.
    expect(worldMenu.lastElementChild?.previousElementSibling).toHaveAttribute(
      "role",
      "separator",
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(names(menuOf("Hoodit"))).toEqual([
      "Manage",
      "Rename",
      "Resume",
      "Archive",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(names(menuOf("Old"))).toEqual(["Manage", "Restore"]);
  });

  it("renders a wallet with one address as that address row", async () => {
    const solo = wallet("g-solo", "Solo", {
      addresses: [{ family: "evm", address: SOLO, wallet_id: "w_14" }],
    });
    list.wallets = [trading, solo];
    await renderSection([...rows, agentRow(SOLO, "14", false, "Solo")]);
    const row = parent("g-solo");
    expect(row.querySelectorAll("[data-wallet-row]")).toHaveLength(1);
    expect(
      within(row).queryByRole("button", { name: /^(Show|Hide) / }),
    ).toBeNull();
    expect(within(row).getByText("Solo")).toBeInTheDocument();
    // Its ⋯ is the wallet's own menu; copy stays on the row, the explorer
    // lives in Manage › Receive.
    fireEvent.click(
      within(row).getByRole("button", { name: /^Actions for Solo / }),
    );
    expect(names(screen.getByRole("menu"))).toEqual([
      "Manage",
      "Rename",
      "Pause",
      "Archive",
    ]);
  });

  it("pauses one wallet; Resume all shows only while everything is paused", async () => {
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
    expect(screen.queryByRole("button", { name: "Resume all" })).toBeNull();
  });

  it("resumes everything when all wallets were paused", async () => {
    list.pause_all = true;
    await renderSection();
    expect(
      screen.getByText("Hosted by Aomi · all paused, nothing signs"),
    ).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Resume all" })),
    );
    expect(writes().at(-1)).toEqual({
      method: "PUT",
      path: "/v1/account/pause-all",
      body: { paused: false },
    });
  });

  it("renames in a dialog", async () => {
    await renderSection();
    fireEvent.click(within(menuOf("World")).getByText("Rename"));
    const dialog = await screen.findByRole("dialog", {
      name: "Rename agent wallet",
    });
    const input = within(dialog).getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("World");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Markets " } });
    await act(async () => fireEvent.submit(input));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Rename agent wallet" }),
      ).toBeNull(),
    );
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

  it("manages a wallet: who can use it, actions, and Receive with QR, the address and its networks", async () => {
    await renderSection();
    const sheet = await manage("Trading");
    // Who can use it, each with its lane on this wallet; the portal is not
    // listed.
    expect(within(sheet).getByText("Who can use it")).toBeInTheDocument();
    expect(await within(sheet).findByText("Claude Code")).toBeInTheDocument();
    const lane = within(sheet).getByRole("combobox", {
      name: "Trading: Ask on Aomi",
    });
    expect(within(sheet).queryByText("Aomi")).toBeNull();
    fireEvent.click(lane);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: /^Ask in Claude Code/ }),
      ),
    );
    expect(writes().at(-1)).toEqual({
      method: "PUT",
      path: "/v1/account/connections/oauth%3Ac1/wallets",
      body: { wallets: [{ id: "g-trading", lane: "here" }] },
    });
    // Send, Rename and a Pause switch, then Archive alone at the bottom.
    const actions = within(sheet)
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((text) =>
        ["Send", "Rename", "Archive"].some((label) => text === label),
      );
    expect(actions).toEqual(["Send", "Rename", "Archive"]);
    expect(
      within(sheet).getByRole("switch", { name: "Pause Trading" }),
    ).toHaveAttribute("aria-checked", "false");

    fireEvent.click(within(sheet).getByRole("button", { name: /Receive/ }));
    const receive = await screen.findByRole("dialog");
    expect(
      within(receive).getByRole("img", { name: `QR code for ${EVM}` }),
    ).toBeInTheDocument();
    expect(receive).toHaveTextContent(EVM);
    expect(
      within(receive).getByRole("link", { name: "View on explorer" }),
    ).toHaveAttribute("href", expect.stringContaining(EVM));
    for (const network of ["Ethereum", "Base", "Robinhood Chain", "Arc"])
      expect(within(receive).getByText(network)).toBeInTheDocument();
    expect(within(receive).queryByText("Sepolia")).toBeNull();
    fireEvent.click(within(receive).getByRole("radio", { name: "Solana" }));
    expect(receive).toHaveTextContent(SVM);
    expect(within(receive).queryByText("Base")).toBeNull();
  });

  it("shows no family tabs on Receive for a one-address wallet, and Restore alone when archived", async () => {
    const solo = wallet("g-solo", "Solo", {
      addresses: [{ family: "evm", address: SOLO, wallet_id: "w_14" }],
    });
    list.wallets = [trading, solo, old];
    await renderSection([...rows, agentRow(SOLO, "14", false, "Solo")]);
    fireEvent.click(
      within(menuOf(`Solo ${shortAddress(SOLO)}`)).getByText("Manage"),
    );
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /Receive/ }));
    const receive = await screen.findByRole("dialog");
    expect(receive).toHaveTextContent(SOLO);
    expect(within(receive).queryByRole("radiogroup")).toBeNull();
    fireEvent.click(
      within(receive).getAllByRole("button", { name: "Close" })[0]!,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
    const archived = await manage("Old");
    expect(
      within(archived).getByRole("button", { name: "Restore" }),
    ).toBeInTheDocument();
    for (const gone of ["Rename", "Archive"])
      expect(within(archived).queryByRole("button", { name: gone })).toBeNull();
    expect(within(archived).queryByRole("switch")).toBeNull();
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
    await screen.findByRole("button", { name: "Actions for Trading" });
    fireEvent.click(
      within(await manage("Trading")).getByRole("button", {
        name: "Send",
      }),
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
    commit.second = "submitted";
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
    // The USDC transfer confirmed, the ETH one is still on its way.
    expect(await screen.findByText("Withdrawing…")).toBeInTheDocument();
    act(() => {
      commit.second = "confirmed";
      commit.listeners.forEach((listener) => listener());
    });
    expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
    expect(screen.getByText("View transfer 2 on explorer")).toBeInTheDocument();
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
    fireEvent.click(
      within(await manage("Trading")).getByRole("button", {
        name: "Send",
      }),
    );
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
