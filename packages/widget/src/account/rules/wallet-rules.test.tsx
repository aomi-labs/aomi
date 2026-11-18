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
  signAndSendSolanaTransaction: vi.fn(async (_: object) => ({
    signature: "5ig",
  })),
  signOutAccount: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  refreshAccount: vi.fn(async () => undefined),
}));
vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => kit }));

const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOL = "solana:mainnet-beta/native";
const USDC_RULE = `${USDC}@protocol:uniswap`;
const FRIEND = "0x00000000000000000000000000000000000000aa";
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
    mode: "blacklist",
    rules: [
      {
        id: USDC_RULE,
        asset: USDC,
        amount: "200000000",
        to: { kind: "protocol", id: "uniswap" },
        symbol: "USDC",
        decimals: 6,
      },
    ],
    linked_only: false,
  },
  sentences: [],
  admin: { kind: "aomi_managed" },
  stopped_until: null,
  usage: [
    {
      rule: USDC_RULE,
      asset: USDC,
      used: "170000000",
      cap: "200000000",
      symbol: "USDC",
      decimals: 6,
    },
  ],
  window_ends_at: 1795046400,
  pending: null,
  enforced_by: { [USDC_RULE]: ["Aomi"] },
  enforcement: [],
  admin_wallets: [{ kind: "wallet", family: "evm", address: ADMIN }],
  ...extra,
});
/** One on-chain provider. The widget knows it only by what this says. */
const provider = (extra: object = {}) => ({
  provider: "vault",
  name: "Vault",
  network: "solana:mainnet-beta",
  state: "off",
  rules: [],
  holds: {},
  left: {},
  note: null,
  ready: true,
  signer: { family: "svm", address: null },
  ...extra,
});
const STEP = `/v1/account/agent-wallets/${WALLET.id}/rules/enforcement/vault`;
const enforcementRow = () =>
  document.querySelector("[data-rule-enforcement]") as HTMLElement;

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
    kit.signAndSendSolanaTransaction,
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
const sentRules = (index: number) =>
  (writes()[index]!.body as { rules: AomiRuleSet }).rules;
const HELD = {
  asset: USDC,
  amount: "200000000",
  to: { kind: "protocol", id: "uniswap" },
};
const ruleRows = () =>
  [...document.querySelectorAll('[data-rule="rule"]')] as HTMLElement[];
const button = (name: string | RegExp) => screen.getByRole("button", { name });
/** Fill the new-rule field the way a person does, then press + Rule. */
async function addRule(
  token: string,
  amount: string,
  to: string | { address: string },
  chain?: string,
) {
  fireEvent.click(button("Token"));
  fireEvent.click(await screen.findByRole("button", { name: token }));
  fireEvent.change(screen.getByRole("textbox", { name: "Amount a day" }), {
    target: { value: amount },
  });
  if (chain) {
    fireEvent.click(button("Chain"));
    fireEvent.click(screen.getByRole("button", { name: chain }));
  } else fireEvent.click(button("To"));
  if (typeof to === "string") fireEvent.click(button(to));
  else {
    fireEvent.change(screen.getByRole("textbox", { name: "Send to address" }), {
      target: { value: to.address },
    });
    fireEvent.click(button("Use address"));
  }
  await act(async () => {
    fireEvent.click(button("Rule"));
  });
}

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
    // A comma only groups thousands; "1,2" is a typo, not 12.
    expect(toBaseUnits("1,250.5", 6)).toBe("1250500000");
    expect(toBaseUnits("1,234,567", 0)).toBe("1234567");
    expect(toBaseUnits("1,2", 6)).toBeNull();
    expect(toBaseUnits("12,34", 6)).toBeNull();
    expect(toBaseUnits(",5", 6)).toBeNull();
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
  it("shows the sends switch, the mode, and each rule with where it goes, today's use and who enforces it", async () => {
    const section = await renderRules();
    expect(
      within(section).getByRole("switch", {
        name: "Only allow sending to linked wallets",
      }),
    ).not.toBeChecked();
    expect(
      within(section).getByRole("radio", { name: "Blacklist" }),
    ).toBeChecked();
    expect(section).toHaveTextContent(
      "Everything is allowed, except what’s listed.",
    );
    const [rule] = ruleRows();
    expect(rule).toHaveTextContent("Up to 200 USDC a day");
    expect(within(rule!).getByText("Base")).toBeInTheDocument();
    expect(await within(rule!).findByText("Uniswap")).toBeInTheDocument();
    expect(rule).toHaveTextContent("170 used today");
    expect(
      within(rule!).getByRole("progressbar", { name: "USDC used today" }),
    ).toHaveAttribute("aria-valuenow", "85");
    expect(rule).toHaveTextContent("Enforced by Aomi");
    // No app list, no limit list, no end date, no templates.
    expect(screen.queryByRole("button", { name: /App$/ })).toBeNull();
    expect(screen.queryByText(/template/i)).toBeNull();
    expect(screen.queryByLabelText("End date")).toBeNull();
  });

  it("says who else enforces a rule, and that an empty list means opposite things in each mode", async () => {
    rules = body({ enforced_by: { [USDC_RULE]: ["Aomi", "Vault"] } });
    await renderRules();
    expect(ruleRows()[0]).toHaveTextContent("Enforced by Aomi and Vault");

    rules = body({
      rules: { mode: "blacklist", rules: [], linked_only: false },
    });
    document.body.innerHTML = "";
    await renderRules();
    expect(
      await screen.findByText("No rules. This wallet can spend anything."),
    ).toBeInTheDocument();
  });

  it("says a whitelist with nothing listed spends nothing, and a zero amount blocks", async () => {
    rules = body({
      rules: {
        mode: "whitelist",
        rules: [
          { ...HELD, id: USDC_RULE, amount: "0", symbol: "USDC", decimals: 6 },
        ],
        linked_only: false,
      },
      usage: [],
    });
    const section = await renderRules();
    expect(
      within(section).getByRole("radio", { name: "Whitelist" }),
    ).toBeChecked();
    expect(ruleRows()[0]).toHaveTextContent("No USDC");
    expect(ruleRows()[0]).not.toHaveTextContent("used today");
  });

  it("adds a rule from token / amount / chain / to, sending the full set and no server fields", async () => {
    respond = (method) =>
      method === "POST"
        ? Response.json({ status: "applied", rules })
        : undefined;
    await renderRules();
    // SOL is on one chain, so the chain fills itself; Solana offers its apps.
    await addRule("SOL", "0.5", "Jupiter");
    expect(sentRules(0)).toEqual({
      mode: "blacklist",
      rules: [
        HELD,
        {
          asset: SOL,
          amount: "500000000",
          to: { kind: "protocol", id: "jupiter" },
        },
      ],
      linked_only: false,
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("offers only the apps of the rule's chain, and any protocol", async () => {
    await renderRules();
    fireEvent.click(button("Token"));
    fireEvent.click(await screen.findByRole("button", { name: "USDC" }));
    fireEvent.click(button("To"));
    const list = screen.getByRole("group", {
      name: "To: a protocol, or an address",
    });
    expect(
      within(list).getByRole("button", { name: "Any protocol" }),
    ).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Uniswap" })).toBeTruthy();
    expect(within(list).queryByRole("button", { name: "Jupiter" })).toBeNull();
  });

  it("puts a new amount in place of the rule for the same token and destination", async () => {
    respond = (method) =>
      method === "POST"
        ? Response.json({
            status: "waiting",
            rules: body({ pending: change() }),
          })
        : undefined;
    await renderRules();
    await addRule("USDC", "400", "Uniswap");
    expect(sentRules(0).rules).toEqual([{ ...HELD, amount: "400000000" }]);
    // A raise waits: its card opens.
    expect(
      await screen.findByRole("region", {
        name: "Rule change for Trading wallet",
      }),
    ).toBeInTheDocument();
  });

  it("adds a rule for a send to one address, and refuses one that is not of the chain", async () => {
    respond = (method) =>
      method === "POST"
        ? Response.json({ status: "applied", rules })
        : undefined;
    await renderRules();
    fireEvent.click(button("Token"));
    fireEvent.click(await screen.findByRole("button", { name: "USDC" }));
    fireEvent.click(button("To"));
    const address = screen.getByRole("textbox", { name: "Send to address" });
    fireEvent.change(address, {
      target: { value: "HZpj1111111111111111111111111111111111PvRpW" },
    });
    fireEvent.click(button("Use address"));
    expect(
      screen.getByText("That isn’t an address on Base."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await addRule("USDC", "20", { address: FRIEND });
    expect(sentRules(0).rules[1]).toEqual({
      asset: USDC,
      amount: "20000000",
      to: { kind: "address", address: FRIEND },
    });
  });

  it("asks for what is missing before it sends anything", async () => {
    await renderRules();
    await act(async () => {
      fireEvent.click(button("Rule"));
    });
    expect(
      screen.getByText("Fill in the token, amount, chain and to."),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "USDC" }));
    fireEvent.click(button("To"));
    fireEvent.click(button("Uniswap"));
    await act(async () => {
      fireEvent.click(button("Rule"));
    });
    expect(
      screen.getByText("Enter an amount. 0 blocks the token there."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("removes a rule, switches the mode and flips the sends switch, each as the full set", async () => {
    respond = (method) =>
      method === "POST"
        ? Response.json({ status: "applied", rules })
        : undefined;
    await renderRules();
    await act(async () => {
      fireEvent.click(button("Remove the rule for USDC · Uniswap"));
    });
    expect(sentRules(0)).toEqual({
      mode: "blacklist",
      rules: [],
      linked_only: false,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Whitelist" }));
    });
    expect(sentRules(1)).toEqual({
      mode: "whitelist",
      rules: [HELD],
      linked_only: false,
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Only allow sending to linked wallets",
        }),
      );
    });
    expect(sentRules(2).linked_only).toBe(true);
  });

  it("reads the rules again when they changed under an edit", async () => {
    respond = (method) =>
      method === "POST" ? refused("rules_changed", 409) : undefined;
    await renderRules();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Whitelist" }));
    });
    expect(
      await screen.findByText("The rules changed. Review them again."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        calls.filter(
          (call) => call.method === "GET" && call.path.endsWith("/rules"),
        ).length,
      ).toBeGreaterThan(1),
    );
  });

  it("offers Try again in the new-rule lists when the catalog cannot be read", async () => {
    let fail = true;
    respond = (_method, path) =>
      path.endsWith("/rules/catalog") && fail
        ? refused("internal_error", 500)
        : undefined;
    await renderRules();
    fireEvent.click(button("Token"));
    expect(
      await screen.findByText("Couldn’t load the list."),
    ).toBeInTheDocument();
    fail = false;
    await act(async () => {
      fireEvent.click(button("Try again"));
    });
    expect(
      await screen.findByRole("button", { name: "USDC" }),
    ).toBeInTheDocument();
  });

  it("changes the rule change authority only on Save, and shows wallets once one is to be selected", async () => {
    respond = (method) =>
      method === "POST"
        ? Response.json({
            status: "waiting",
            rules: body({
              pending: change({
                lines: [
                  {
                    text: "Admin: Aomi-managed → wallet 0xAbCd…Ef12",
                    loosens: false,
                  },
                ],
              }),
            }),
          })
        : undefined;
    await renderRules();
    const authority = screen.getByRole("region", {
      name: "Rule change authority",
    });
    expect(
      within(authority).getByRole("radio", { name: /Self-approval/ }),
    ).toBeChecked();
    expect(within(authority).queryByRole("combobox")).toBeNull();
    fireEvent.click(
      within(authority).getByRole("radio", { name: /Selected wallet/ }),
    );
    expect(
      within(authority).getByRole("combobox", { name: "Wallet" }),
    ).toBeTruthy();
    expect(writes()).toHaveLength(0);
    // Cancel puts it back and sends nothing.
    fireEvent.click(within(authority).getByRole("button", { name: "Cancel" }));
    expect(within(authority).queryByRole("combobox")).toBeNull();
    fireEvent.click(
      within(authority).getByRole("radio", { name: /Selected wallet/ }),
    );
    await act(async () => {
      fireEvent.click(within(authority).getByRole("button", { name: "Save" }));
    });
    expect(writes()[0]!.body).toEqual({
      admin: { kind: "wallet", family: "evm", address: ADMIN },
    });
  });

  it("shows no on-chain row where nothing is on chain and nothing can go there", async () => {
    rules = body({ enforcement: [provider({ ready: false })] });
    await renderRules();
    expect(enforcementRow()).toBeNull();
  });

  it("puts the rules on chain with one signature, and never sends a policy", async () => {
    kit.identity.svmAddress = "Own3r";
    rules = body({ enforcement: [provider()] });
    const on = body({
      enforced_by: { [USDC_RULE]: ["Aomi", "Vault"] },
      enforcement: [
        provider({
          state: "on",
          ready: false,
          rules: [USDC_RULE],
          signer: { family: "svm", address: "Own3r" },
        }),
      ],
    });
    respond = (method, path) => {
      if (method !== "POST") return undefined;
      if (path === `${STEP}/prepare`)
        return Response.json({
          action: {
            kind: "transaction",
            network: "solana:mainnet-beta",
            unsigned_base64: "AQAB",
          },
        });
      if (path === `${STEP}/confirm`) return Response.json({ rules: on });
      return undefined;
    };
    await renderRules();
    expect(enforcementRow()).toHaveTextContent(
      "Vault can also enforce these rules on chain.",
    );
    await act(async () => {
      fireEvent.click(button("+ Vault"));
    });
    await waitFor(() =>
      expect(ruleRows()[0]).toHaveTextContent("Enforced by Aomi and Vault"),
    );
    expect(kit.signAndSendSolanaTransaction).toHaveBeenCalledTimes(1);
    expect(writes().map((call) => call.body)).toEqual([
      { network: "solana:mainnet-beta", revision: 3, owner: "Own3r" },
      { network: "solana:mainnet-beta", revision: 3, owner: "Own3r" },
    ]);
    expect(button("Remove from Vault")).toBeEnabled();
  });

  it("offers the update when the chain holds older rules, only to the wallet that owns it", async () => {
    rules = body({
      enforcement: [
        provider({
          state: "behind",
          note: "Your rules changed since you signed.",
          signer: { family: "svm", address: "Own3r" },
        }),
      ],
    });
    await renderRules();
    expect(enforcementRow()).toHaveTextContent(
      "Your rules changed since you signed. Connect Own3r to change this.",
    );
    expect(button("Update Vault")).toBeDisabled();
  });

  it("keeps a filed change when an older read answers late", async () => {
    let answer: (response: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    let gets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "https://portal.test");
        if (url.pathname === "/v1/account/rules/catalog")
          return Response.json(catalog);
        gets += 1;
        return slow;
      }),
    );
    const filed = body({ pending: change() });
    const view = render(<WalletRules wallet={WALLET} />, {
      wrapper: AccountOverviewFixture,
    });
    await waitFor(() => expect(gets).toBe(1));
    // The lane control files a change while the first read is in flight.
    view.rerender(<WalletRules wallet={WALLET} filed={filed as never} />);
    expect(
      await screen.findByLabelText("Rule change for Trading wallet"),
    ).toBeTruthy();
    await act(async () => {
      answer(Response.json(body()));
      await slow;
    });
    expect(
      screen.getByLabelText("Rule change for Trading wallet"),
    ).toBeTruthy();
  });

  it("stops offering a decision the moment the change expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const soon = Math.floor(Date.now() / 1000) + 20;
      rules = body({ pending: change({ expires_at: soon }) });
      await renderRules();
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
      const card = screen.getByLabelText("Rule change for Trading wallet");
      expect(
        within(card).getByRole("button", { name: "Approve" }),
      ).toBeEnabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(21_000);
      });
      expect(within(card).getByText("expired")).toBeTruthy();
      expect(
        within(card).getByRole("button", { name: "Approve" }),
      ).toBeDisabled();
      expect(
        within(card).getByRole("button", { name: "Decline" }),
      ).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the wallet signed when sending the signature fails", async () => {
    kit.identity.address = ADMIN;
    rules = body({
      admin: { kind: "wallet", family: "evm", address: ADMIN },
      pending: change({
        signer: { kind: "wallet", family: "evm", address: ADMIN },
        sign_message: "Aomi rule change ch-1",
      }),
    });
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    respond = (method) => {
      if (method === "POST") throw new TypeError("network down");
      return undefined;
    };
    fireEvent.click(screen.getByRole("button", { name: "Sign in wallet" }));
    expect(
      await screen.findByText(
        "Your wallet signed, but the change couldn’t be sent. Check the rules before trying again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Nothing was signed. Try again.")).toBeNull();
    // A prompt the user closes still says nothing was signed.
    kit.signMessage.mockRejectedValueOnce(new Error("User rejected"));
    fireEvent.click(screen.getByRole("button", { name: "Sign in wallet" }));
    expect(
      await screen.findByText("Nothing was signed. Try again."),
    ).toBeTruthy();
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
      screen.getByText(
        "Only a signature from Ledger (0xAbCd…Ef12) changes this wallet’s rules.",
      ),
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
    expect(await screen.findByText("Self-approval")).toBeTruthy();
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
