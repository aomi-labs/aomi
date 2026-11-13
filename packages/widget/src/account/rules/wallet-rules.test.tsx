import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AomiRuleSet } from "@aomi-labs/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountOverviewFixture } from "@/test/account-overview-fixture";
import { RuleChangePanel } from "./rule-change-card";
import { fromBaseUnits, toBaseUnits, usedPercent } from "./rules-model";
import { WalletRules } from "./wallet-rules";

const ADMIN = "0xAbCd00000000000000000000000000000000Ef12";
const kit = vi.hoisted(() => ({
  identity: {
    address: undefined as string | undefined,
    svmAddress: undefined as string | undefined,
    svmCluster: "solana:mainnet",
  },
  wallets: [] as { family: string; address: string; label: string }[],
  signMessage: vi.fn(async () => ({ signature: "0xsigned" })),
  signSolanaMessage: vi.fn(async () => ({ signature: "c2lnbmVk" })),
  signOutAccount: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  refreshAccount: vi.fn(async () => undefined),
}));
vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => kit }));

const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOL = "solana:mainnet-beta/native";
const WALLET = { id: "g-trading", name: "Trading wallet" };
const hours = (count: number) =>
  Math.floor(Date.now() / 1000) + count * 3600 + 600;

const change = (extra: object = {}) => ({
  id: "ch-1",
  agent_wallet_id: WALLET.id,
  wallet_name: WALLET.name,
  lines: [{ text: "USDC on Base: 200 → 400 a day", loosens: true }],
  state: "awaiting_admin",
  proposed_by: "portal",
  expires_at: hours(23),
  signer: null,
  sign_message: null,
  ...extra,
});
const body = (extra: object = {}) => ({
  agent_wallet_id: WALLET.id,
  wallet_name: WALLET.name,
  revision: 3,
  rules: {
    apps: ["jupiter", "kamino"],
    limits: [{ asset: USDC, amount: "200000000", symbol: "USDC", decimals: 6 }],
    not_after: 1795219200,
    owner_only: true,
  },
  sentences: [],
  admin: { kind: "aomi_managed" },
  stopped_until: null,
  usage: [
    {
      asset: USDC,
      used: "170000000",
      cap: "200000000",
      symbol: "USDC",
      decimals: 6,
    },
  ],
  window_ends_at: 1795046400,
  pending: null,
  enforced_by: ["aomi"],
  admin_wallets: [{ kind: "wallet", family: "evm", address: ADMIN }],
  ...extra,
});
const catalog = {
  apps: [
    { id: "jupiter", label: "Jupiter", chains: ["solana:mainnet-beta"] },
    { id: "kamino", label: "Kamino", chains: ["solana:mainnet-beta"] },
    { id: "uniswap", label: "Uniswap", chains: ["eip155:1", "eip155:8453"] },
  ],
  tokens: [
    { asset: USDC, symbol: "USDC", decimals: 6, chain: "Base" },
    { asset: SOL, symbol: "SOL", decimals: 9, chain: "Solana" },
  ],
};

let rules: ReturnType<typeof body>;
let calls: { method: string; path: string; body: unknown }[] = [];
let respond: (
  method: string,
  path: string,
  sent: unknown,
) => Response | undefined;
const writes = () => calls.filter((call) => call.method !== "GET");
const refused = (error: string, status: number) =>
  Response.json({ error }, { status });

beforeEach(() => {
  calls = [];
  rules = body();
  respond = () => undefined;
  kit.identity.address = undefined;
  kit.identity.svmAddress = undefined;
  kit.wallets = [];
  for (const mock of [
    kit.signMessage,
    kit.signSolanaMessage,
    kit.signOutAccount,
    kit.disconnect,
  ])
    mock.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://portal.test");
      const method = init?.method ?? "GET";
      const sent = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: url.pathname, body: sent });
      const answer = respond(method, url.pathname, sent);
      if (answer) return answer;
      if (url.pathname === "/v1/account/rules/catalog")
        return Response.json(catalog);
      if (url.pathname === "/v1/account/rule-changes/ch-1")
        return Response.json(rules.pending ?? change());
      return Response.json(rules);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderRules() {
  await act(async () => {
    render(<WalletRules wallet={WALLET} />, {
      wrapper: AccountOverviewFixture,
    });
  });
  return screen.findByRole("region", { name: "Rules" });
}
const NO_RULES = { apps: null, limits: [], not_after: null, owner_only: false };
const sentRules = (index: number) =>
  (writes()[index]!.body as { rules: AomiRuleSet }).rules;
const row = (kind: string) =>
  document.querySelector(`[data-rule="${kind}"]`) as HTMLElement;
const setLimit = (value: string) => {
  const input = screen.getByRole("textbox", { name: "USDC daily limit" });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("rules amounts", () => {
  it("converts human amounts with string math, past 2^53", () => {
    expect(toBaseUnits("0.5", 9)).toBe("500000000");
    expect(toBaseUnits("200", 6)).toBe("200000000");
    expect(toBaseUnits("12345678901234567890.000000000000000001", 18)).toBe(
      "12345678901234567890000000000000000001",
    );
    expect(toBaseUnits(".5", 1)).toBe("5");
    expect(toBaseUnits("0.1234567", 6)).toBeNull();
    expect(toBaseUnits("1e3", 6)).toBeNull();
    expect(toBaseUnits("", 6)).toBeNull();
    expect(fromBaseUnits("500000000", 9)).toBe("0.5");
    expect(fromBaseUnits("12345678901234567890000000000000000001", 18)).toBe(
      "12345678901234567890.000000000000000001",
    );
    expect(fromBaseUnits("0", 6)).toBe("0");
    expect(usedPercent("170000000", "200000000")).toBe(85);
    expect(usedPercent("99999999999999999999", "1")).toBe(100);
  });
});

describe("Wallet rules", () => {
  it("shows each rule as a sentence with its control, today's use and the admin", async () => {
    const section = await renderRules();
    expect(within(section).getByText("Enforced by Aomi")).toBeTruthy();
    expect(row("apps")).toHaveTextContent("Can use Jupiter, Kamino");
    const cap = document.querySelector(`[data-asset="${USDC}"]`) as HTMLElement;
    expect(cap).toHaveTextContent("Up to 200 USDC a day");
    expect(within(cap).getByText("Base")).toBeTruthy();
    expect(within(cap).getByText("170 used")).toBeTruthy();
    const bar = within(cap).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "85");
    expect(bar.firstElementChild).toHaveAttribute("data-usage-tone", "warning");
    expect(
      within(cap).getByRole("textbox", { name: "USDC daily limit" }),
    ).toHaveValue("200");
    expect(row("not_after")).toHaveTextContent("Until Nov 21");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-11-21");
    expect(row("owner_only")).toHaveTextContent("Sends only to your wallets");
    expect(
      screen.getByRole("switch", { name: "Sends only to your wallets" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("Tokens without a limit can't be spent"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Lower a number and it saves at once. Raise one and it needs approval. Limits reset at 00:00 UTC.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Aomi-managed")).toBeTruthy();
    expect(
      screen.getByText(
        "You approve with a click or a tap. Aomi holds the admin key.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Stopped by the agent/)).toBeNull();
    expect(document.querySelector("[data-pending-change]")).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("keeps the usage bar neutral under 80% and says when the agent stopped the wallet", async () => {
    rules = body({
      stopped_until: 1795046400,
      usage: [{ ...body().usage[0], used: "100000000" }],
    });
    await renderRules();
    expect(screen.getByRole("progressbar").firstElementChild).toHaveAttribute(
      "data-usage-tone",
      "neutral",
    );
    expect(
      screen.getByText("Stopped by the agent until 00:00 UTC"),
    ).toBeTruthy();
  });

  it("shows an unknown token by its short address and raw amount", async () => {
    const unknown = "eip155:1/erc20:0x1111111111111111111111111111111111112222";
    rules = body({
      rules: { ...NO_RULES, limits: [{ asset: unknown, amount: "5000" }] },
      usage: [],
    });
    await renderRules();
    expect(
      document.querySelector(`[data-asset="${unknown}"]`),
    ).toHaveTextContent("Up to 5000 0x1111…2222 a day");
    expect(screen.getByText("Ethereum")).toBeTruthy();
  });

  it("saves a lower limit at once with the full set and no display fields", async () => {
    await renderRules();
    respond = (method, _path, sent) => {
      if (method !== "POST") return undefined;
      rules = body({
        revision: 4,
        rules: (sent as { rules: object }).rules,
      });
      return Response.json({ status: "applied", rules });
    };
    setLimit("100");
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/account/agent-wallets/g-trading/rules",
      body: {
        rules: {
          apps: ["jupiter", "kamino"],
          limits: [{ asset: USDC, amount: "100000000" }],
          not_after: 1795219200,
          owner_only: true,
        },
      },
    });
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(document.querySelector("[data-rule-change]")).toBeNull();
  });

  it("opens the rule change card when a raise has to wait, and approves it", async () => {
    await renderRules();
    respond = (method, path) => {
      if (method !== "POST") return undefined;
      if (path.endsWith("/approve")) {
        rules = body({
          revision: 4,
          rules: {
            ...body().rules,
            limits: [{ ...body().rules.limits[0], amount: "400000000" }],
          },
        });
        return Response.json(rules);
      }
      rules = body({ pending: change() });
      return Response.json({ status: "waiting", rules });
    };
    setLimit("400");
    const card = await screen.findByRole("region", {
      name: "Rule change for Trading wallet",
    });
    expect(card).toHaveTextContent("Rule change · Trading wallet");
    expect(card).toHaveTextContent("expires in 23 h");
    const line = within(card).getByText("USDC on Base: 200 → 400 a day");
    expect(line.closest("li")).toHaveAttribute("data-loosens", "true");
    expect(screen.queryByText("Saved.")).toBeNull();
    // The limit stays at 200 until the admin approves.
    expect(
      screen.getByRole("textbox", { name: "USDC daily limit" }),
    ).toHaveValue("200");

    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Approved.")).toBeTruthy();
    expect(writes()[1]).toEqual({
      method: "POST",
      path: "/v1/account/rule-changes/ch-1/approve",
      body: {},
    });
    expect(document.querySelector("[data-rule-change]")).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "USDC daily limit" }),
    ).toHaveValue("400");
  });

  it("shows a change the agent filed as a banner, then Review or Decline", async () => {
    rules = body({
      pending: change({ proposed_by: "agent:telegram:7712345678" }),
    });
    await renderRules();
    const banner = document.querySelector(
      "[data-pending-change]",
    ) as HTMLElement;
    expect(banner).toHaveTextContent(
      "Aomi asks: USDC on Base: 200 → 400 a day",
    );
    expect(banner).toHaveTextContent("23 h left");
    fireEvent.click(within(banner).getByRole("button", { name: "Review" }));
    const card = screen.getByRole("region", {
      name: "Rule change for Trading wallet",
    });
    fireEvent.click(within(card).getByRole("button", { name: "Later" }));
    respond = (method) => {
      if (method !== "POST") return undefined;
      rules = body();
      return Response.json(rules);
    };
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Declined.")).toBeTruthy();
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/v1/account/rule-changes/ch-1/decline",
        body: {},
      },
    ]);
    expect(document.querySelector("[data-pending-change]")).toBeNull();
  });

  it("says Waiting for approval for a change the owner filed", async () => {
    rules = body({ pending: change() });
    await renderRules();
    expect(document.querySelector("[data-pending-change]")).toHaveTextContent(
      "Waiting for approval: USDC on Base: 200 → 400 a day",
    );
  });

  it("asks the admin wallet to sign the exact message and sends its signature", async () => {
    kit.identity.address = ADMIN.toLowerCase();
    kit.wallets = [{ family: "evm", address: ADMIN, label: "Ledger" }];
    rules = body({
      admin: { kind: "wallet", family: "evm", address: ADMIN },
      pending: change({
        signer: { kind: "wallet", family: "evm", address: ADMIN },
        sign_message: "Aomi rule change ch-1\nUSDC on Base: 200 → 400 a day",
      }),
    });
    await renderRules();
    expect(screen.getByText("Ledger (0xAbCd…Ef12)")).toBeTruthy();
    expect(
      screen.getByText("Approve by signing. Aomi can't loosen anything."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    respond = (method) => {
      if (method !== "POST") return undefined;
      rules = body({ admin: rules.admin });
      return Response.json(rules);
    };
    fireEvent.click(screen.getByRole("button", { name: "Sign in wallet" }));
    expect(await screen.findByText("Approved.")).toBeTruthy();
    expect(kit.signMessage).toHaveBeenCalledWith({
      non_typed_data: "Aomi rule change ch-1\nUSDC on Base: 200 → 400 a day",
    });
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/v1/account/rule-changes/ch-1/approve",
        body: { signature: "0xsigned" },
      },
    ]);
  });

  it("signs a Solana admin's message as base64 of its UTF-8 bytes", async () => {
    const mint = "HZpj1111111111111111111111111111111111111111";
    kit.identity.svmAddress = mint;
    rules = body({
      pending: change({
        signer: { kind: "wallet", family: "svm", address: mint },
        sign_message: "limit → 400",
      }),
    });
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in wallet" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const sent = kit.signSolanaMessage.mock.calls[0] as unknown as [
      { message: string; signer: string },
    ];
    expect(sent[0].signer).toBe(mint);
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(sent[0].message), (char) => char.charCodeAt(0)),
      ),
    ).toBe("limit → 400");
    expect(writes()[0]!.body).toEqual({ signature: "c2lnbmVk" });
  });

  it("names the wallet that must sign when another one is connected", async () => {
    kit.identity.address = "0x9999000000000000000000000000000000001111";
    rules = body({
      pending: change({
        signer: { kind: "wallet", family: "evm", address: ADMIN },
        sign_message: "m",
      }),
    });
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      screen.getByText(
        "Connect 0xAbCd…Ef12 to sign. 0x9999…1111 is connected now.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sign in wallet" }),
    ).toBeDisabled();
    expect(kit.signMessage).not.toHaveBeenCalled();
  });

  it("asks an old sign-in to sign in again before approving", async () => {
    rules = body({ pending: change() });
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    respond = (method) =>
      method === "POST" ? refused("login_stale", 403) : undefined;
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText("For a rule change, sign in again."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(kit.signOutAccount).toHaveBeenCalledTimes(1));
    // The change is still waiting.
    expect(document.querySelector("[data-rule-change]")).toBeTruthy();
  });

  it("reads the rules again when the change was already decided", async () => {
    rules = body({ pending: change() });
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    respond = (method) => {
      if (method !== "POST") return undefined;
      rules = body();
      return refused("rules_change_not_open", 409);
    };
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText("That change was already decided."),
    ).toBeTruthy();
    expect(document.querySelector("[data-rule-change]")).toBeNull();
    expect(
      calls.filter(
        (call) => call.method === "GET" && call.path.endsWith("/rules"),
      ),
    ).toHaveLength(2);
  });

  it("reads the rules again when they changed under an edit", async () => {
    await renderRules();
    respond = (method) =>
      method === "POST" ? refused("rules_changed", 409) : undefined;
    setLimit("100");
    expect(
      await screen.findByText("The rules changed. Review them again."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        calls.filter(
          (call) => call.method === "GET" && call.path.endsWith("/rules"),
        ),
      ).toHaveLength(2),
    );
  });

  it("starts from No rules and opens the same editor with Set rules", async () => {
    rules = body({ revision: 0, rules: NO_RULES, usage: [] });
    await renderRules();
    expect(
      screen.getByText(
        "No rules. This wallet follows only who approves trades.",
      ),
    ).toBeTruthy();
    expect(row("apps")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set rules" }));
    expect(row("apps")).toHaveTextContent("Can use any app");
    expect(row("not_after")).toHaveTextContent("No end date");
    expect(row("owner_only")).toHaveTextContent("Sends to any address");
    expect(screen.getByText("No limits. Any token can be spent.")).toBeTruthy();
    expect(
      screen.queryByText("Tokens without a limit can't be spent"),
    ).toBeNull();

    respond = (method, _path, sent) => {
      if (method !== "POST") return undefined;
      rules = body({
        revision: 1,
        usage: [],
        rules: (sent as { rules: object }).rules,
      });
      return Response.json({ status: "applied", rules });
    };
    fireEvent.click(
      screen.getByRole("switch", { name: "Sends only to your wallets" }),
    );
    await waitFor(() =>
      expect(writes()[0]?.body).toEqual({
        rules: { ...NO_RULES, owner_only: true },
      }),
    );
  });

  it("says an app list already keeps sends to the owner's wallets", async () => {
    rules = body({
      rules: { ...NO_RULES, apps: ["jupiter"] },
      usage: [],
      enforced_by: ["aomi", "swig"],
    });
    const section = await renderRules();
    expect(within(section).getByText("Enforced by Aomi + Swig")).toBeTruthy();
    expect(row("owner_only")).toHaveTextContent("Sends only to your wallets");
    expect(row("owner_only")).toHaveTextContent("With an app list");
    const toggle = screen.getByRole("switch", {
      name: "Sends only to your wallets",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeDisabled();
  });

  it("sets a wallet's first rules from a template", async () => {
    rules = body({ revision: 0, rules: NO_RULES, usage: [] });
    await renderRules();
    respond = (method, _path, sent) => {
      if (method !== "POST") return undefined;
      rules = body({
        revision: 1,
        usage: [],
        rules: (sent as { rules: object }).rules,
      });
      return Response.json({ status: "applied", rules });
    };
    fireEvent.click(screen.getByRole("button", { name: "Use a template" }));
    const picker = screen.getByRole("group", { name: "Rule templates" });
    expect(within(picker).getByText("Only my wallets")).toBeTruthy();
    expect(within(picker).getByText("Two-week trial")).toBeTruthy();
    fireEvent.click(
      within(picker).getByRole("button", { name: "Use USDC budget" }),
    );
    await waitFor(() =>
      expect(writes()[0]?.body).toEqual({
        rules: {
          ...NO_RULES,
          owner_only: true,
          limits: [{ asset: USDC, amount: "100000000" }],
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "Rule templates" }),
      ).toBeNull(),
    );
    expect(document.querySelector(`[data-asset="${USDC}"]`)).not.toBeNull();
  });

  it("sends a template that gives more power to the approval card", async () => {
    await renderRules();
    respond = (method, _path, sent) => {
      if (method !== "POST") return undefined;
      expect((sent as { rules: AomiRuleSet }).rules).toEqual({
        ...NO_RULES,
        owner_only: true,
      });
      rules = body({
        pending: change({
          lines: [{ text: "Can use any app", loosens: true }],
        }),
      });
      return Response.json({ status: "waiting", rules });
    };
    fireEvent.click(screen.getByRole("button", { name: "Use a template" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use Only my wallets" }),
    );
    expect(await screen.findByText("Can use any app")).toBeTruthy();
    expect(rules.rules.apps).toEqual(["jupiter", "kamino"]);
  });

  it("adds a limit for a catalog token in human units", async () => {
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Limit" }));
    const picker = screen.getByRole("group", { name: "New limit" });
    // USDC already has a limit: only SOL is left to pick.
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["SOL on Solana"]);
    const add = within(picker).getByRole("button", { name: "Add limit" });
    expect(add).toBeDisabled();
    fireEvent.change(within(picker).getByLabelText("Daily amount"), {
      target: { value: "0.5" },
    });
    fireEvent.click(add);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(sentRules(0).limits).toEqual([
      { asset: USDC, amount: "200000000" },
      { asset: SOL, amount: "500000000" },
    ]);
  });

  it("picks apps from the catalog, several at once, and removes one", async () => {
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "App" }));
    const picker = screen.getByRole("group", { name: "Allowed apps" });
    expect(within(picker).getByLabelText("Jupiter")).toBeChecked();
    fireEvent.click(within(picker).getByLabelText("Uniswap"));
    fireEvent.click(within(picker).getByLabelText("Kamino"));
    fireEvent.click(within(picker).getByRole("button", { name: "Save apps" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(sentRules(0).apps).toEqual(["jupiter", "uniswap"]);
  });

  it("moves the end date and removes it", async () => {
    await renderRules();
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-12-01" },
    });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(sentRules(0).not_after).toBe(
      Date.UTC(2026, 11, 1, 23, 59, 59) / 1000,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove end date" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(sentRules(1)).toEqual({
      apps: ["jupiter", "kamino"],
      limits: [{ asset: USDC, amount: "200000000" }],
      not_after: null,
      owner_only: true,
    });
  });

  it("changes the admin to one of the account's wallets and shows the card", async () => {
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const picker = screen.getByRole("radiogroup", {
      name: "Who can loosen rules",
    });
    const [managed, wallet] = within(picker).getAllByRole("radio");
    expect(managed).toBeChecked();
    respond = (method) => {
      if (method !== "POST") return undefined;
      rules = body({
        pending: change({
          lines: [{ text: "Admin: Aomi-managed → 0xAbCd…Ef12", loosens: true }],
        }),
      });
      return Response.json({ status: "waiting", rules });
    };
    fireEvent.click(wallet!);
    const card = await screen.findByRole("region", {
      name: "Rule change for Trading wallet",
    });
    expect(card).toHaveTextContent("Admin: Aomi-managed → 0xAbCd…Ef12");
    expect(writes()[0]!.body).toEqual({
      admin: { kind: "wallet", family: "evm", address: ADMIN },
    });
  });

  it("offers Try again when the rules cannot be read", async () => {
    respond = (_method, path) =>
      path.endsWith("/rules") ? refused("internal_error", 500) : undefined;
    await act(async () => {
      render(<WalletRules wallet={WALLET} />, {
        wrapper: AccountOverviewFixture,
      });
    });
    expect(await screen.findByText("Couldn’t load the rules.")).toBeTruthy();
    respond = () => undefined;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Aomi-managed")).toBeTruthy();
  });
});

describe("RuleChangePanel", () => {
  const client = async () =>
    (await import("@/account/transport")).createShellTransport().aomi;

  it("renders the waiting change's card and its outcome once approved", async () => {
    rules = body({ pending: change() });
    render(
      <RuleChangePanel
        client={await client()}
        changeId="ch-1"
        onClose={vi.fn()}
      />,
    );
    const card = await screen.findByRole("region", {
      name: "Rule change for Trading wallet",
    });
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    respond = (method) =>
      method === "POST" ? Response.json(body()) : undefined;
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("USDC on Base: 200 → 400 a day")).toBeTruthy();
  });

  it.each([
    ["applied", "Approved"],
    ["declined", "Declined"],
    ["expired", "Expired"],
    ["superseded", "Replaced by a newer change"],
  ])("shows a %s change as %s", async (state, title) => {
    rules = body({ pending: change({ state }) });
    render(
      <RuleChangePanel
        client={await client()}
        changeId="ch-1"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("says when the change does not exist", async () => {
    respond = () => refused("rules_change_not_found", 404);
    render(
      <RuleChangePanel
        client={await client()}
        changeId="ch-1"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("This change doesn’t exist")).toBeTruthy();
  });
});
