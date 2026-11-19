import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AomiRuleSet } from "@aomi-labs/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountOverviewFixture } from "@/test/account-overview-fixture";
import { PoliciesSettings } from "./policies-settings";
import type { VaultReader } from "./vault-chain";
import type { VaultHolding } from "./vault-model";
import { DELEGATION_MANAGER } from "./vault-withdraw";
import {
  dayFromToday,
  endOfLocalDay,
  localDay,
  policyDay,
} from "./policy-model";

const ADMIN = "0xAbCd00000000000000000000000000000000Ef12";
const OTHER = "0x1111000000000000000000000000000000002222";
const AGENT = "0x3333000000000000000000000000000000004444";
const OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
type Row = {
  family: string;
  address: string;
  kind: string;
  connected: boolean;
  label?: string;
  provider?: string;
  brand?: string;
  loginEmail?: string;
};
const kit = vi.hoisted(() => ({
  identity: {
    address: undefined as string | undefined,
    svmAddress: undefined as string | undefined,
    svmCluster: "solana:mainnet",
    chainId: 1,
  },
  wallets: [] as Row[],
  signMessage: vi.fn(async () => ({ signature: "0xsigned" })),
  signTypedData: vi.fn(async (_: object) => ({
    signature: `0x${"ab".repeat(65)}`,
  })),
  switchChain: vi.fn(async (_: number) => undefined),
  sendTransaction: vi.fn(async (..._: unknown[]) => ({ txHash: "0xsent" })),
  signSolanaMessage: vi.fn(async () => ({ signature: "c2lnbmVk" })),
  signAndSendSolanaTransaction: vi.fn(async (_: object) => ({
    signature: "5ig",
  })),
  signOutAccount: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  refreshAccount: vi.fn(async () => undefined),
}));
vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => kit }));
// The chain is never read: the vault rows get this fake reader.
const chain = vi.hoisted(() => ({
  hasCode: vi.fn(async (_chain: number, _vault: string) => true),
  balances: vi.fn(
    async (_chain: number, _vault: string, tokens: readonly unknown[]) =>
      (tokens as VaultHolding["token"][]).map((token) => ({
        token,
        raw:
          "native" in token.asset
            ? BigInt("980000000000000000")
            : BigInt(95_000_000),
      })),
  ),
}));
vi.mock("./vault-chain", () => ({
  viemVaultReader: (): VaultReader => chain,
}));

const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OP_USDC = "eip155:10/erc20:0x0b2c639c533813f4aa9d7837caf62653d097ff85";
const SOL = "solana:mainnet-beta/native";
const USDC_RULE = `${USDC}@protocol:uniswap`;
const SOL_RULE = `${SOL}@protocol:jupiter`;
const FRIEND = "0x00000000000000000000000000000000000000aa";
const WALLET = { id: "g-trading", name: "Trading wallet" };
const hours = (count: number) =>
  Math.floor(Date.now() / 1000) + count * 3600 + 600;
const FROM = Math.floor(Date.now() / 1000) - 7 * 86_400;
const day = (seconds: number) => policyDay(localDay(seconds));

const agentWallet = (id: string, name: string, archived_at: number | null) => ({
  id,
  name,
  paused: false,
  archived_at,
  app: null,
  last_used_at: null,
  created_at: 1_760_000_000,
  addresses: [],
  connections: [],
});
const change = (extra: object = {}) => ({
  id: "ch-1",
  agent_wallet_id: WALLET.id,
  wallet_name: WALLET.name,
  lines: [{ text: "USDC on Base: 200 → 400", loosens: true }],
  state: "awaiting_admin",
  proposed_by: "portal",
  expires_at: hours(23),
  signer: null,
  sign_message: null,
  ...extra,
});
const HELD = {
  asset: USDC,
  amount: "200000000",
  to: { kind: "protocol", id: "uniswap" },
};
const usdcRule = (extra: object = {}) => ({
  ...HELD,
  id: USDC_RULE,
  active_from: FROM,
  symbol: "USDC",
  decimals: 6,
  ...extra,
});
const solRule = (extra: object = {}) => ({
  id: SOL_RULE,
  asset: SOL,
  amount: "500000000",
  to: { kind: "protocol", id: "jupiter" },
  active_from: FROM,
  symbol: "SOL",
  decimals: 9,
  ...extra,
});
const body = (extra: object = {}) => ({
  agent_wallet_id: WALLET.id,
  wallet_name: WALLET.name,
  revision: 3,
  rules: { mode: "blacklist", rules: [usdcRule()], linked_only: false },
  sentences: [],
  admin: { kind: "aomi_managed" },
  stopped_until: null,
  pending: null,
  enforced_by: { [USDC_RULE]: ["Aomi"] },
  enforcement: [],
  admin_wallets: [{ kind: "wallet", family: "evm", address: ADMIN }],
  ...extra,
});
/**
 * One provider's entry for one rule. The widget knows the provider only by
 * what this says; it defaults to the Solana rule, not on chain, ready to sign.
 */
const provider = (extra: object = {}) => ({
  rule: SOL_RULE,
  provider: "vault",
  name: "Vault",
  network: "solana:mainnet-beta",
  state: "off",
  ready: true,
  left: null,
  expires_at: null,
  account: null,
  deployment_tx: null,
  note: null,
  signer: { family: "svm", address: null },
  ...extra,
});
/** A rule held by a signed grant on Base: no deployment, no transaction. */
const grant = (extra: object = {}) =>
  provider({
    rule: USDC_RULE,
    provider: "metamask",
    name: "MetaMask",
    network: "eip155:8453",
    signer: { family: "evm", address: null },
    ...extra,
  });
const STEP = `/v1/account/agent-wallets/${WALLET.id}/rules/enforcement/vault`;
const GRANT_STEP = `/v1/account/agent-wallets/${WALLET.id}/rules/enforcement/metamask`;
const VAULT = "0x00000000000000000000000000000000000000a1";

const catalog = {
  apps: [
    { id: "jupiter", label: "Jupiter", chains: ["solana:mainnet-beta"] },
    { id: "kamino", label: "Kamino", chains: ["solana:mainnet-beta"] },
    { id: "uniswap", label: "Uniswap", chains: ["eip155:10", "eip155:8453"] },
    { id: "aerodrome", label: "Aerodrome", chains: ["eip155:8453"] },
  ],
  tokens: [
    { asset: USDC, symbol: "USDC", decimals: 6, chain: "Base" },
    { asset: OP_USDC, symbol: "USDC", decimals: 6, chain: "OP" },
    { asset: SOL, symbol: "SOL", decimals: 9, chain: "Solana" },
  ],
};

let rules: ReturnType<typeof body>;
let wallets: ReturnType<typeof agentWallet>[];
let calls: { method: string; path: string; body: unknown }[] = [];
let respond: (
  method: string,
  path: string,
  sent: unknown,
) => Response | undefined;
const writes = () => calls.filter((call) => call.method !== "GET");
const reads = (path: string) =>
  calls.filter((call) => call.method === "GET" && call.path.endsWith(path));
const refused = (error: string, status: number) =>
  Response.json({ error }, { status });
const applied = () => {
  respond = (method) =>
    method === "POST" ? Response.json({ status: "applied", rules }) : undefined;
};

beforeEach(() => {
  calls = [];
  rules = body();
  wallets = [
    agentWallet(WALLET.id, WALLET.name, null),
    agentWallet("g-old", "Old", 1_760_000_100),
  ];
  respond = () => undefined;
  kit.identity.address = undefined;
  kit.identity.svmAddress = undefined;
  kit.identity.chainId = 1;
  kit.wallets = [];
  chain.hasCode.mockClear();
  chain.balances.mockClear();
  for (const mock of [
    kit.signMessage,
    kit.signTypedData,
    kit.switchChain,
    kit.sendTransaction,
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
      if (url.pathname === "/v1/account/agent-wallets")
        return Response.json({ pause_all: false, wallets });
      if (url.pathname === "/v1/account/rules/catalog")
        return Response.json(catalog);
      return Response.json(rules);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPolicies() {
  await act(async () => {
    render(<PoliciesSettings />, { wrapper: AccountOverviewFixture });
  });
  const card = await screen.findByRole("region", {
    name: "Trading wallet policies",
  });
  await within(card).findByText("Policy change authority");
  return card;
}
const sentRules = (index: number) =>
  (writes()[index]!.body as { rules: AomiRuleSet }).rules;
const rows = () =>
  [...document.querySelectorAll("[data-policy]")] as HTMLElement[];
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const changeCard = () =>
  screen.findByRole("region", { name: "Policy change for Trading wallet" });
/** Open the picker and fill `token / amount / chain / to` as a person does. */
async function fillPolicy(
  token: string,
  amount: string,
  to: string | { address: string },
  chains: string[] = [],
) {
  if (!document.querySelector("[data-policy-picker]"))
    fireEvent.click(button("Policy"));
  fireEvent.click(await screen.findByRole("button", { name: token }));
  fireEvent.change(screen.getByRole("textbox", { name: "Total amount" }), {
    target: { value: amount },
  });
  // A token on several chains asks which; one on a single chain does not.
  for (const chain of chains) fireEvent.click(button(chain));
  if (chains.length) fireEvent.click(button("Next"));
  if (typeof to === "string") fireEvent.click(button(to));
  else {
    fireEvent.change(screen.getByRole("textbox", { name: "Send to address" }), {
      target: { value: to.address },
    });
    fireEvent.click(button("Use address"));
  }
}
const submit = () =>
  act(async () => {
    fireEvent.click(button("Policy"));
  });

describe("Settings › Policies", () => {
  it("lists each live agent wallet with its switches, policies and authority, and counts no spend", async () => {
    const card = await renderPolicies();
    expect(
      within(card).getByRole("switch", {
        name: "Only allow transfers to linked wallet",
      }),
    ).not.toBeChecked();
    // Blacklist is the "only policy-defined actions" switch turned off.
    expect(
      within(card).getByRole("switch", {
        name: "Only allow policy-defined actions",
      }),
    ).not.toBeChecked();
    expect(card).toHaveTextContent("Not enforceable on chain.");
    const [row] = rows();
    expect(row).toHaveTextContent("Up to 200 USDC on Uniswap");
    expect(within(row!).getByRole("img", { name: "Base" })).toBeInTheDocument();
    expect(row).toHaveTextContent(
      `Active period: Always on, since ${day(FROM)}`,
    );
    expect(row).toHaveTextContent("Onchain Enforcement:None");
    expect(row).toHaveTextContent("Total not enforced");
    // The total never resets and nothing counts what was spent.
    expect(card).not.toHaveTextContent(/a day|used/);
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(
      within(card).getByRole("radio", { name: "Self-approval" }),
    ).toBeChecked();
    // An archived wallet has no policies to show.
    expect(screen.queryByRole("region", { name: "Old policies" })).toBeNull();
    expect(calls.some((call) => call.path.includes("g-old"))).toBe(false);
    expect(reads("/rules/catalog")).toHaveLength(1);
  });

  it("offers Try again when a wallet's policies cannot be read", async () => {
    respond = (_method, path) =>
      path.endsWith("/rules") ? refused("internal_error", 500) : undefined;
    await act(async () => {
      render(<PoliciesSettings />, { wrapper: AccountOverviewFixture });
    });
    expect(
      await screen.findByText("Couldn’t load the policies."),
    ).toBeInTheDocument();
    respond = () => undefined;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Policy change authority")).toBeTruthy();
  });

  it("says so when the account has no agent wallet", async () => {
    wallets = [];
    await act(async () => {
      render(<PoliciesSettings />, { wrapper: AccountOverviewFixture });
    });
    expect(await screen.findByText(/No agent wallets yet/)).toBeInTheDocument();
  });

  it("reads the policies again when the tab comes back into view", async () => {
    const view = render(<PoliciesSettings active />, {
      wrapper: AccountOverviewFixture,
    });
    await screen.findByText("Policy change authority");
    view.rerender(<PoliciesSettings active={false} />);
    rules = body({ pending: change() });
    view.rerender(<PoliciesSettings active />);
    expect(await changeCard()).toBeInTheDocument();
    expect(reads("/rules")).toHaveLength(2);
  });

  it("turns the two switches into the mode and the sends flag, each as the full set", async () => {
    applied();
    await renderPolicies();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Only allow policy-defined actions",
        }),
      );
    });
    // The held rule goes back as it is, without what the server fills in.
    expect(sentRules(0)).toEqual({
      mode: "whitelist",
      rules: [HELD],
      linked_only: false,
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Only allow transfers to linked wallet",
        }),
      );
    });
    expect(sentRules(1)).toEqual({
      mode: "blacklist",
      rules: [HELD],
      linked_only: true,
    });
  });

  it("shows a whitelist as the switch turned on", async () => {
    rules = body({
      rules: { mode: "whitelist", rules: [usdcRule()], linked_only: true },
    });
    const card = await renderPolicies();
    expect(
      within(card).getByRole("switch", {
        name: "Only allow policy-defined actions",
      }),
    ).toBeChecked();
    expect(card).toHaveTextContent(
      "The agent can do only what a policy lists.",
    );
    await act(async () => {
      fireEvent.click(
        within(card).getByRole("switch", {
          name: "Only allow policy-defined actions",
        }),
      );
    });
    expect(sentRules(0).mode).toBe("blacklist");
  });

  it("adds a policy from token / amount / chain / to, sending the full set and no server fields", async () => {
    applied();
    await renderPolicies();
    // SOL is on one chain, so the chain fills itself; Solana offers its apps.
    await fillPolicy("SOL", "0.5", "Jupiter");
    await submit();
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
    // An answered save closes the picker.
    expect(document.querySelector("[data-policy-picker]")).toBeNull();
  });

  it("sends an active period as the end of the chosen local day", async () => {
    applied();
    await renderPolicies();
    await fillPolicy("SOL", "1", "Any protocol");
    fireEvent.click(button("Set active period"));
    fireEvent.click(button("1 week"));
    expect(
      screen.getByText(`through ${policyDay(dayFromToday(7))}`),
    ).toBeInTheDocument();
    await submit();
    const week = endOfLocalDay(dayFromToday(7));
    expect(sentRules(0).rules[1]).toEqual({
      asset: SOL,
      amount: "1000000000",
      to: { kind: "any_protocol" },
      active_until: week,
    });
    expect(new Date(week * 1000).getHours()).toBe(23);

    // A date of the owner's choosing.
    await fillPolicy("SOL", "2", "Kamino");
    fireEvent.click(button("Set active period"));
    await submit();
    expect(
      screen.getByText(
        "Pick how long the policy is active, or remove the period.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(button("Pick a date"));
    const picked = dayFromToday(45);
    fireEvent.change(screen.getByLabelText("Active through"), {
      target: { value: picked },
    });
    await submit();
    expect(sentRules(1).rules.at(-1)).toMatchObject({
      to: { kind: "protocol", id: "kamino" },
      active_until: endOfLocalDay(picked),
    });
  });

  it("says when the end is not in the future", async () => {
    respond = (method) =>
      method === "POST" ? refused("rules_period_invalid", 400) : undefined;
    await renderPolicies();
    await fillPolicy("SOL", "1", "Jupiter");
    await submit();
    expect(
      await screen.findByText("Pick an end date in the future."),
    ).toBeInTheDocument();
  });

  it("adds one policy on each picked chain in one change, offering only what every chain has", async () => {
    applied();
    await renderPolicies();
    fireEvent.click(button("Policy"));
    fireEvent.click(await screen.findByRole("button", { name: "USDC" }));
    fireEvent.click(button("Base"));
    fireEvent.click(button("Next"));
    const list = () =>
      screen.getByRole("group", { name: "To: a protocol, or an address" });
    // On Base alone: its apps, and the token's contract with its explorer.
    expect(
      within(list()).getByRole("button", { name: "Aerodrome" }),
    ).toBeTruthy();
    expect(
      within(list()).queryByRole("button", { name: "Jupiter" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: /0x8335…2913/ })).toHaveAttribute(
      "href",
      "https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    );
    fireEvent.click(button("Aerodrome"));
    // A second chain drops a destination it does not have.
    fireEvent.click(button("Chain"));
    fireEvent.click(button("OP"));
    fireEvent.click(button("Next"));
    expect(
      within(list()).queryByRole("button", { name: "Aerodrome" }),
    ).toBeNull();
    expect(button("To")).toHaveTextContent("to");
    fireEvent.click(within(list()).getByRole("button", { name: "Uniswap" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Total amount" }), {
      target: { value: "1000" },
    });
    await submit();
    expect(writes()).toHaveLength(1);
    // Base already had a rule for USDC on Uniswap: its amount is replaced.
    expect(sentRules(0).rules).toEqual([
      { ...HELD, amount: "1000000000" },
      {
        asset: OP_USDC,
        amount: "1000000000",
        to: { kind: "protocol", id: "uniswap" },
      },
    ]);
  });

  it("opens the waiting change at the top when a save gives the agent more", async () => {
    respond = (method) =>
      method === "POST"
        ? Response.json({
            status: "waiting",
            rules: body({ pending: change() }),
          })
        : undefined;
    await renderPolicies();
    await fillPolicy("USDC", "400", "Uniswap", ["Base"]);
    await submit();
    expect(sentRules(0).rules).toEqual([{ ...HELD, amount: "400000000" }]);
    const card = await changeCard();
    expect(card).toHaveTextContent("Policy change · Trading wallet");
    expect(card).toHaveTextContent("USDC on Base: 200 → 400");
    expect(
      await screen.findByText("Waiting for approval."),
    ).toBeInTheDocument();
    // It sits above the wallet's own card.
    expect(
      card.compareDocumentPosition(
        screen.getByRole("region", { name: "Trading wallet policies" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("adds a policy for a send to one address, and refuses one that is not of the chain", async () => {
    applied();
    await renderPolicies();
    fireEvent.click(button("Policy"));
    fireEvent.click(await screen.findByRole("button", { name: "USDC" }));
    fireEvent.click(button("Base"));
    fireEvent.click(button("Next"));
    fireEvent.change(screen.getByRole("textbox", { name: "Send to address" }), {
      target: { value: "HZpj1111111111111111111111111111111111PvRpW" },
    });
    fireEvent.click(button("Use address"));
    expect(
      screen.getByText("That isn’t an address on Base."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    fireEvent.change(screen.getByRole("textbox", { name: "Send to address" }), {
      target: { value: FRIEND },
    });
    fireEvent.click(button("Use address"));
    fireEvent.change(screen.getByRole("textbox", { name: "Total amount" }), {
      target: { value: "20" },
    });
    await submit();
    expect(sentRules(0).rules[1]).toEqual({
      asset: USDC,
      amount: "20000000",
      to: { kind: "address", address: FRIEND },
    });
  });

  it("takes no address across chains that write them differently", async () => {
    // A token on Base and on Solana.
    catalog.tokens.push({
      asset:
        "solana:mainnet-beta/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      symbol: "USDC",
      decimals: 6,
      chain: "Solana",
    });
    try {
      await renderPolicies();
      fireEvent.click(button("Policy"));
      fireEvent.click(await screen.findByRole("button", { name: "USDC" }));
      fireEvent.click(button("Base"));
      fireEvent.click(button("Solana"));
      fireEvent.click(button("Next"));
      expect(
        screen.getByText("One address can’t be used across these chains."),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: "Send to address" }),
      ).toBeNull();
    } finally {
      catalog.tokens.pop();
    }
  });

  it("asks for what is missing before it sends anything", async () => {
    await renderPolicies();
    fireEvent.click(button("Policy"));
    await submit();
    expect(
      screen.getByText("Fill in the token, amount, chain and to."),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "SOL" }));
    fireEvent.click(button("Jupiter"));
    await submit();
    expect(
      screen.getByText("Enter an amount. 0 blocks the token there."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("shows policies that differ only by chain as one row, and removes them in one change", async () => {
    const onOp = usdcRule({
      id: `${OP_USDC}@protocol:uniswap`,
      asset: OP_USDC,
    });
    rules = body({
      rules: {
        mode: "blacklist",
        rules: [usdcRule(), solRule(), onOp],
        linked_only: false,
      },
    });
    applied();
    await renderPolicies();
    expect(rows()).toHaveLength(2);
    const [merged, sol] = rows();
    expect(merged).toHaveTextContent("Up to 200 USDC on Uniswap");
    expect(
      within(merged!)
        .getAllByRole("img")
        .map((mark) => mark.getAttribute("aria-label")),
    ).toEqual(["Base", "OP"]);
    expect(sol).toHaveTextContent("Up to 0.5 SOL on Jupiter");
    await act(async () => {
      fireEvent.click(button("Remove the policy for USDC on Uniswap"));
    });
    expect(writes()).toHaveLength(1);
    expect(sentRules(0)).toEqual({
      mode: "blacklist",
      rules: [
        {
          asset: SOL,
          amount: "500000000",
          to: { kind: "protocol", id: "jupiter" },
        },
      ],
      linked_only: false,
    });
  });

  it("says a zero total blocks, and keeps an ended policy listed as ended", async () => {
    const ended = Math.floor(Date.now() / 1000) - 86_400;
    const until = hours(24 * 20);
    rules = body({
      rules: {
        mode: "whitelist",
        rules: [
          usdcRule({ amount: "0" }),
          solRule({ active_until: ended }),
          solRule({
            id: `${SOL}@any`,
            to: { kind: "any_protocol" },
            active_until: until,
          }),
        ],
        linked_only: false,
      },
    });
    applied();
    await renderPolicies();
    const [blocked, over, open] = rows();
    expect(blocked).toHaveTextContent("No USDC on Uniswap");
    // A block needs no total enforced.
    expect(blocked).not.toHaveTextContent("Total not enforced");
    expect(over).toHaveAttribute("data-ended", "true");
    expect(over).toHaveTextContent(`Ended ${day(ended)}`);
    expect(over).not.toHaveTextContent("Active period");
    expect(open).not.toHaveAttribute("data-ended");
    expect(open).toHaveTextContent(
      `Active period: ${day(FROM)} – ${day(until)}`,
    );
    expect(open).toHaveTextContent("Up to 0.5 SOL on any protocol");
    // A write keeps each rule's end, and never sends its start.
    await act(async () => {
      fireEvent.click(button("Remove the policy for USDC on Uniswap"));
    });
    expect(sentRules(0).rules).toEqual([
      {
        asset: SOL,
        amount: "500000000",
        to: { kind: "protocol", id: "jupiter" },
        active_until: ended,
      },
      {
        asset: SOL,
        amount: "500000000",
        to: { kind: "any_protocol" },
        active_until: until,
      },
    ]);
  });

  it("reads the policies again when they changed under an edit", async () => {
    respond = (method) =>
      method === "POST" ? refused("rules_changed", 409) : undefined;
    await renderPolicies();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Only allow policy-defined actions",
        }),
      );
    });
    expect(
      await screen.findByText("The policies changed. Review them again."),
    ).toBeInTheDocument();
    await waitFor(() => expect(reads("/rules").length).toBeGreaterThan(1));
  });

  it("offers Try again in the picker when the catalog cannot be read", async () => {
    let fail = true;
    respond = (_method, path) =>
      path.endsWith("/rules/catalog") && fail
        ? refused("internal_error", 500)
        : undefined;
    await renderPolicies();
    fireEvent.click(button("Policy"));
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

  it("says when the agent stopped the wallet", async () => {
    rules = body({ stopped_until: hours(5) });
    const card = await renderPolicies();
    expect(card).toHaveTextContent("Stopped by the agent until 00:00 UTC");
  });

  describe("policy change authority", () => {
    const wallet = (address: string, extra: Partial<Row> = {}): Row => ({
      family: "evm",
      address,
      kind: "embedded",
      connected: true,
      provider: "para",
      loginEmail: "you@example.com",
      ...extra,
    });

    it("offers only signed-in wallets, never an agent wallet, and changes it only on Save", async () => {
      kit.wallets = [
        wallet(ADMIN),
        // Linked, but not signed in on this device.
        wallet(OTHER, { connected: false, provider: "privy" }),
        wallet(AGENT, { kind: "agent", label: "Trading wallet" }),
      ];
      rules = body({
        admin_wallets: [ADMIN, OTHER, AGENT].map((address) => ({
          kind: "wallet",
          family: "evm",
          address,
        })),
      });
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
      const card = await renderPolicies();
      const pick = (name: string) => within(card).getByRole("radio", { name });
      expect(pick("Self-approval")).toBeChecked();
      expect(
        within(card).queryByRole("radiogroup", {
          name: "Wallet that approves changes",
        }),
      ).toBeNull();
      fireEvent.click(pick("Selected wallet"));
      const list = within(card).getByRole("radiogroup", {
        name: "Wallet that approves changes",
      });
      const options = within(list).getAllByRole("radio");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Para");
      expect(options[0]).toHaveTextContent(
        "0xAbCd…Ef12 · you@example.com · EVM",
      );
      expect(options[0]).toBeChecked();
      expect(card).toHaveTextContent(
        "Only a signed-in wallet can change policy. Sign in with Privy to use a Privy wallet.",
      );
      expect(writes()).toHaveLength(0);
      // Cancel puts it back and sends nothing.
      fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
      expect(pick("Self-approval")).toBeChecked();
      fireEvent.click(pick("Selected wallet"));
      await act(async () => {
        fireEvent.click(within(card).getByRole("button", { name: "Save" }));
      });
      expect(writes()[0]!.body).toEqual({
        admin: { kind: "wallet", family: "evm", address: ADMIN },
      });
      // A new authority is itself a change that waits.
      expect(await changeCard()).toHaveTextContent(
        "Admin: Aomi-managed → wallet 0xAbCd…Ef12",
      );
    });

    it("cannot select a wallet when none is signed in", async () => {
      kit.wallets = [wallet(ADMIN, { connected: false })];
      const card = await renderPolicies();
      expect(
        within(card).getByRole("radio", { name: "Selected wallet" }),
      ).toBeDisabled();
    });

    it("shows the wallet that is the authority now, and goes back to self-approval", async () => {
      kit.wallets = [wallet(ADMIN, { connected: false })];
      rules = body({
        admin: { kind: "wallet", family: "evm", address: ADMIN },
        admin_wallets: [],
      });
      applied();
      const card = await renderPolicies();
      expect(
        within(card).getByRole("radio", { name: "Selected wallet" }),
      ).toBeChecked();
      expect(
        within(card).getByRole("radio", { name: /0xAbCd…Ef12/ }),
      ).toBeChecked();
      fireEvent.click(
        within(card).getByRole("radio", { name: "Self-approval" }),
      );
      await act(async () => {
        fireEvent.click(within(card).getByRole("button", { name: "Save" }));
      });
      expect(writes()[0]!.body).toEqual({ admin: { kind: "aomi_managed" } });
    });
  });

  describe("the picker's on-chain hint", () => {
    const SWIG = {
      provider: "swig",
      name: "Swig",
      network: "solana:mainnet-beta",
      holds: "total_period_and_destination",
      note: null,
    };
    const METAMASK = {
      provider: "metamask",
      name: "MetaMask",
      network: "eip155:8453",
      holds: "total_and_period",
      note: null,
    };
    /** A wallet with no rule at all, so no entry says who could hold one. */
    const empty = (extra: object = {}) =>
      body({
        rules: { mode: "whitelist", rules: [], linked_only: false },
        enforcement: [],
        ...extra,
      });
    const hint = () =>
      (document.querySelector("[data-policy-picker]")!.textContent ?? "")
        .replace(/\s+/g, " ")
        .replace("Enforcement: ", "Enforcement:");

    it("names Swig for a Solana policy on a wallet with no rules", async () => {
      rules = empty({ providers: [SWIG, METAMASK] });
      await renderPolicies();
      await fillPolicy("SOL", "0.3", "Jupiter");
      expect(hint()).toContain("Onchain Enforcement:Swig");
      expect(hint()).toContain("It starts when you sign its deployment.");
      // Swig holds the destination too: nothing is left to Aomi alone.
      expect(hint()).not.toContain("Aomi alone checks");
      expect(hint()).not.toContain("None");
    });

    it("says None, and what Aomi checks, where no provider covers the network", async () => {
      rules = empty({ providers: [SWIG] });
      await renderPolicies();
      await fillPolicy("USDC", "10", "Uniswap", ["Base"]);
      expect(hint()).toContain("Onchain Enforcement:None");
      expect(hint()).toContain(
        "Aomi checks the destination and period; the total isn’t enforced.",
      );
    });

    it("says None when the backend lists no provider at all", async () => {
      rules = empty();
      await renderPolicies();
      await fillPolicy("SOL", "0.3", "Jupiter");
      expect(hint()).toContain("Onchain Enforcement:None");
    });

    it("names MetaMask on Base and says Aomi alone checks an app's destination", async () => {
      rules = empty({ providers: [SWIG, METAMASK] });
      await renderPolicies();
      await fillPolicy("USDC", "10", "Uniswap", ["Base"]);
      expect(hint()).toContain("Onchain Enforcement:MetaMask");
      expect(hint()).toContain("It starts when you sign its deployment.");
      expect(hint()).toContain(
        "MetaMask holds the total and period on chain; Aomi alone checks the destination.",
      );
    });

    it("leaves that out for an address, which MetaMask holds whole", async () => {
      rules = empty({ providers: [METAMASK] });
      await renderPolicies();
      await fillPolicy("USDC", "10", { address: FRIEND }, ["Base"]);
      expect(hint()).toContain("Onchain Enforcement:MetaMask");
      expect(hint()).not.toContain("Aomi alone checks");
    });

    it("keeps nothing-goes-on-chain wording with the allow-list switch off", async () => {
      rules = body({ providers: [SWIG, METAMASK] });
      await renderPolicies();
      await fillPolicy("SOL", "0.3", "Jupiter");
      expect(hint()).toContain("Onchain Enforcement:None");
      expect(hint()).toContain(
        "With the switch off nothing goes on chain: a block works, a total isn’t enforced.",
      );
      expect(hint()).not.toContain("starts when you sign");
    });
  });

  describe("on-chain enforcement", () => {
    const withSol = (extra: object = {}) =>
      body({
        rules: { mode: "whitelist", rules: [solRule()], linked_only: false },
        ...extra,
      });
    const withUsdc = (extra: object = {}, rule: object = {}) =>
      body({
        rules: {
          mode: "whitelist",
          rules: [usdcRule(rule)],
          linked_only: false,
        },
        ...extra,
      });
    const signature = `0x${"ab".repeat(65)}`;
    /** What a provider answers to prepare and confirm. */
    const answer = (step: string, action: unknown, confirmed: object) => {
      respond = (method, path) => {
        if (method !== "POST") return undefined;
        if (path === `${step}/prepare`) return Response.json({ action });
        if (path === `${step}/confirm`)
          return Response.json({ rules: confirmed });
        return undefined;
      };
    };
    const transaction = {
      kind: "transaction",
      network: "solana:mainnet-beta",
      unsigned_base64: "AQAB",
    };
    const typedData = {
      domain: {
        name: "Delegation",
        version: "1",
        chainId: 8453,
        verifyingContract: "0x00000000000000000000000000000000000000d1",
      },
      types: {
        Delegation: [
          { name: "delegate", type: "address" },
          { name: "cap", type: "uint256" },
          { name: "caveats", type: "Caveat[]" },
        ],
        Caveat: [{ name: "limit", type: "uint256" }],
      },
      primaryType: "Delegation",
      // Above 2^53, so the backend sent decimal strings.
      message: {
        delegate: AGENT,
        cap: "123456789012345678901234567890",
        caveats: [{ limit: "9007199254740993" }],
      },
    };
    const typedAction = {
      kind: "typed_data",
      network: "eip155:8453",
      typed_data: typedData,
    };

    it("shows None where a provider has nothing to sign", async () => {
      rules = withSol({ enforcement: [provider({ ready: false })] });
      await renderPolicies();
      expect(rows()[0]).toHaveTextContent("Onchain Enforcement:None");
      expect(rows()[0]).toHaveTextContent("Total not enforced");
      expect(
        screen.queryByRole("button", { name: "Sign to deploy" }),
      ).toBeNull();
    });

    it("says why a provider declines a rule, and that the total is not enforced", async () => {
      rules = withSol({
        enforcement: [
          provider({ ready: false, note: "Swig cannot hold this rule." }),
        ],
      });
      await renderPolicies();
      expect(rows()[0]).toHaveTextContent("Onchain Enforcement:None");
      expect(rows()[0]).toHaveTextContent("Total not enforced");
      expect(rows()[0]).toHaveTextContent("Swig cannot hold this rule.");
    });

    it("says a rule waiting for its deployment starts when you sign", async () => {
      rules = withSol({
        rules: {
          mode: "whitelist",
          rules: [solRule({ active_from: undefined })],
          linked_only: false,
        },
        enforcement: [provider()],
      });
      await renderPolicies();
      expect(rows()[0]).toHaveTextContent(
        "Active period: always on, starts when you sign",
      );
      expect(rows()[0]).toHaveTextContent("Onchain Enforcement:Vault");
    });

    it("deploys with one signature: prepare, the wallet sends the transaction, confirm", async () => {
      kit.identity.svmAddress = OWNER;
      rules = withSol({ enforcement: [provider()] });
      answer(
        STEP,
        transaction,
        withSol({
          enforced_by: { [SOL_RULE]: ["Aomi", "Vault"] },
          enforcement: [
            provider({
              state: "on",
              ready: false,
              left: "500000000",
              account: OWNER,
              signer: { family: "svm", address: OWNER },
            }),
          ],
        }),
      );
      await renderPolicies();
      expect(rows()[0]).toHaveTextContent("Onchain Enforcement:Vault");
      expect(rows()[0]).not.toHaveTextContent("Total not enforced");
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      // On chain, the provider's name links to the account that holds it, and
      // what the chain still lets through is shown beside it.
      const link = await within(rows()[0]!).findByRole("link", {
        name: "Vault",
      });
      expect(link).toHaveAttribute(
        "href",
        `https://solscan.io/account/${OWNER}`,
      );
      expect(rows()[0]).toHaveTextContent("· 0.5 SOL left");
      expect(
        screen.queryByRole("button", { name: "Sign to deploy" }),
      ).toBeNull();
      expect(kit.signAndSendSolanaTransaction).toHaveBeenCalledTimes(1);
      expect(kit.signAndSendSolanaTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          unsignedTx: "AQAB",
          cluster: "solana:mainnet",
        }),
      );
      expect(kit.signTypedData).not.toHaveBeenCalled();
      // The client sends the rule's own id, never a policy: the backend
      // derives it. A transaction's confirm carries no signature.
      const step = {
        network: "solana:mainnet-beta",
        rule: SOL_RULE,
        revision: 3,
        owner: OWNER,
      };
      expect(writes().map((call) => call.body)).toEqual([step, step]);
    });

    it("signs each rule on its own: the second rule's button runs the second rule", async () => {
      kit.identity.svmAddress = OWNER;
      const any = `${SOL}@any`;
      rules = body({
        rules: {
          mode: "whitelist",
          rules: [
            solRule(),
            solRule({ id: any, to: { kind: "any_protocol" } }),
          ],
          linked_only: false,
        },
        enforcement: [
          provider({ state: "on", ready: false, left: "400000000" }),
          provider({ rule: any }),
        ],
      });
      answer(STEP, transaction, rules);
      await renderPolicies();
      // One row per rule: held and with its own left, and one waiting.
      expect(rows()).toHaveLength(2);
      expect(rows()[0]).toHaveTextContent("· 0.4 SOL left");
      expect(
        within(rows()[0]!).queryByRole("button", { name: "Sign to deploy" }),
      ).toBeNull();
      await act(async () => {
        fireEvent.click(
          within(rows()[1]!).getByRole("button", { name: "Sign to deploy" }),
        );
      });
      expect(
        writes().map((call) => (call.body as { rule: string }).rule),
      ).toEqual([any, any]);
    });

    it("grants with one signature: prepare typed data, the wallet signs it, confirm with the signature", async () => {
      kit.identity.address = ADMIN.toLowerCase();
      rules = withUsdc({ enforcement: [grant()] });
      answer(
        GRANT_STEP,
        typedAction,
        withUsdc({
          enforcement: [
            grant({
              state: "on",
              ready: false,
              left: "200000000",
              account: VAULT,
              // The signed owner may come back in either case.
              signer: { family: "evm", address: ADMIN },
            }),
          ],
        }),
      );
      await renderPolicies();
      // The wallet on Base asks nothing from this row until it is signed.
      let release!: (signed: { signature: string }) => void;
      kit.signTypedData.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      // Before the wallet answers, the row says what is being granted.
      expect(
        await screen.findByText(
          "You’re signing for: Up to 200 USDC on Uniswap (Base), with no end date. Check it in your wallet.",
        ),
      ).toBeInTheDocument();
      expect(button("Waiting for wallet…")).toBeDisabled();
      await act(async () => {
        release({ signature });
      });
      // The wallet was moved to Base, and signed the data with its numbers
      // read as the integers the types declare: nothing sent on chain.
      expect(kit.switchChain).toHaveBeenCalledWith(8453);
      expect(kit.signTypedData).toHaveBeenCalledTimes(1);
      expect(kit.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          signer: ADMIN.toLowerCase(),
          chainId: 8453,
          typed_data: {
            domain: { ...typedData.domain, chainId: 8453 },
            types: typedData.types,
            primaryType: "Delegation",
            message: {
              delegate: AGENT,
              cap: BigInt("123456789012345678901234567890"),
              caveats: [{ limit: BigInt("9007199254740993") }],
            },
          },
        }),
      );
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      // A grant has no transaction: the name links to the owner's account.
      const link = await within(rows()[0]!).findByRole("link", {
        name: "MetaMask",
      });
      expect(link).toHaveAttribute(
        "href",
        `https://basescan.org/address/${VAULT}`,
      );
      expect(rows()[0]).toHaveTextContent("· 200 USDC left");
      expect(screen.queryByText(/You’re signing for/)).toBeNull();
      const step = {
        network: "eip155:8453",
        rule: USDC_RULE,
        revision: 3,
        owner: ADMIN.toLowerCase(),
      };
      expect(writes().map((call) => call.body)).toEqual([
        step,
        { ...step, signature },
      ]);
    });

    it("warns that replacing an earlier grant takes two signatures, and signs each step the backend hands back", async () => {
      kit.identity.address = ADMIN;
      kit.identity.chainId = 8453;
      rules = withUsdc({
        enforcement: [
          grant({
            state: "behind",
            account: VAULT,
            signer: { family: "evm", address: ADMIN },
          }),
        ],
      });
      // The first step removes the grant the chain holds; the row stays
      // ready for the second, which signs the new one.
      answer(GRANT_STEP, typedAction, rules);
      let release!: (signed: { signature: string }) => void;
      kit.signTypedData.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      expect(
        await screen.findByText(
          /Replacing an earlier version takes two signatures/,
        ),
      ).toBeInTheDocument();
      await act(async () => {
        release({ signature });
      });
      expect(
        writes().map((call) => (call.body as { signature?: string }).signature),
      ).toEqual([undefined, signature]);
      expect(button("Sign to deploy")).toBeEnabled();
      expect(screen.queryByText(/two signatures/)).toBeNull();
    });

    it("does not move a wallet that is already on the grant's chain", async () => {
      kit.identity.address = ADMIN;
      kit.identity.chainId = 8453;
      rules = withUsdc({ enforcement: [grant()] });
      answer(GRANT_STEP, typedAction, withUsdc());
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(kit.switchChain).not.toHaveBeenCalled();
      expect(kit.signTypedData).toHaveBeenCalledTimes(1);
    });

    it("confirms straight away when the chain already shows the rule", async () => {
      kit.identity.svmAddress = OWNER;
      rules = withSol({ enforcement: [provider({ state: "behind" })] });
      answer(STEP, null, withSol());
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      expect(kit.signTypedData).not.toHaveBeenCalled();
    });

    it("refuses a step for another network than the entry's, and signs nothing", async () => {
      kit.identity.svmAddress = OWNER;
      rules = withSol({ enforcement: [provider()] });
      answer(STEP, { ...transaction, network: "solana:devnet" }, withSol());
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      expect(
        await screen.findByText(
          "Aomi asked for a signature on another network than this policy's. Nothing was signed.",
        ),
      ).toBeInTheDocument();
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      // Only prepare was sent: nothing is confirmed.
      expect(writes()).toHaveLength(1);
      await waitFor(() => expect(reads("/rules")).toHaveLength(2));
    });

    it("refuses typed data for another network than the entry's, or for another chain in its domain", async () => {
      kit.identity.address = ADMIN;
      rules = withUsdc({ enforcement: [grant()] });
      answer(GRANT_STEP, { ...typedAction, network: "eip155:10" }, withUsdc());
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      expect(
        await screen.findByText(
          "Aomi asked for a signature on another network than this policy's. Nothing was signed.",
        ),
      ).toBeInTheDocument();
      expect(kit.signTypedData).not.toHaveBeenCalled();
      expect(writes()).toHaveLength(1);
      // The action names Base, but the data it asks to sign is for OP.
      answer(
        GRANT_STEP,
        {
          ...typedAction,
          typed_data: {
            ...typedData,
            domain: { ...typedData.domain, chainId: 10 },
          },
        },
        withUsdc(),
      );
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      expect(
        await screen.findByText(
          "The data to sign is for another chain than this policy's.",
        ),
      ).toBeInTheDocument();
      expect(kit.signTypedData).not.toHaveBeenCalled();
      expect(kit.switchChain).not.toHaveBeenCalled();
    });

    it("refuses a kind of step it does not know, and signs nothing", async () => {
      kit.identity.svmAddress = OWNER;
      rules = withSol({ enforcement: [provider()] });
      answer(
        STEP,
        { kind: "user_op", network: "solana:mainnet-beta" },
        withSol(),
      );
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      expect(
        await screen.findByText(/unsupported action: user_op/),
      ).toBeInTheDocument();
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      expect(kit.signTypedData).not.toHaveBeenCalled();
      expect(writes()).toHaveLength(1);
    });

    it("says so when the owner declines the typed-data prompt, and confirms nothing", async () => {
      kit.identity.address = ADMIN;
      rules = withUsdc({ enforcement: [grant()] });
      answer(GRANT_STEP, typedAction, withUsdc());
      kit.signTypedData.mockRejectedValueOnce(
        Object.assign(new Error("User rejected the request."), { code: 4001 }),
      );
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      expect(
        await screen.findByText("Signature declined. Nothing changed."),
      ).toBeInTheDocument();
      expect(writes()).toHaveLength(1);
    });

    it("says what went wrong when the backend refuses the step, and reads the policies again", async () => {
      kit.identity.svmAddress = OWNER;
      rules = withSol({ enforcement: [provider()] });
      respond = (method, path) =>
        method === "POST" && path === `${STEP}/prepare`
          ? refused("rules_not_enforceable", 409)
          : undefined;
      await renderPolicies();
      await act(async () => {
        fireEvent.click(button("Sign to deploy"));
      });
      expect(
        await screen.findByText("These policies can't go on chain yet."),
      ).toBeInTheDocument();
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      await waitFor(() => expect(reads("/rules")).toHaveLength(2));
    });

    it("warns when the chain holds an older version, and lets only the wallet that owns it sign", async () => {
      rules = withSol({
        enforcement: [
          provider({
            state: "behind",
            note: "Your rules changed since you signed.",
            signer: { family: "svm", address: OWNER },
          }),
        ],
      });
      await renderPolicies();
      const [row] = rows();
      expect(row).toHaveTextContent("Onchain Enforcement:Vault");
      expect(row).toHaveTextContent("Out of date");
      expect(row).toHaveTextContent("Your rules changed since you signed.");
      expect(row).toHaveTextContent("Connect 4Nd1mB…DB4T to sign.");
      expect(button("Sign to deploy")).toBeDisabled();
    });

    it("warns without a button when the chain could not be read", async () => {
      rules = withSol({
        enforcement: [
          provider({
            state: "unverified",
            ready: false,
            note: "The chain could not be read.",
          }),
        ],
      });
      await renderPolicies();
      expect(rows()[0]).toHaveTextContent("Not verified");
      expect(rows()[0]).toHaveTextContent("The chain could not be read.");
      expect(
        screen.queryByRole("button", { name: "Sign to deploy" }),
      ).toBeNull();
    });

    it("shows when the chain ends a rule only if that is over a day from the policy's end", async () => {
      const until = hours(24 * 20);
      const withEnd = (expires_at: number) =>
        withSol({
          rules: {
            mode: "whitelist",
            rules: [solRule({ active_until: until })],
            linked_only: false,
          },
          enforcement: [provider({ state: "on", ready: false, expires_at })],
        });
      rules = withEnd(until + 6 * 3600);
      await renderPolicies();
      expect(rows()[0]).not.toHaveTextContent("chain ends");
      cleanup();
      rules = withEnd(until + 3 * 86_400);
      await renderPolicies();
      expect(rows()[0]).toHaveTextContent(
        `· chain ends ${day(until + 3 * 86_400)}`,
      );
    });

    describe("a policy removed while the chain still holds it", () => {
      const NOTE =
        "This rule was removed or has ended. Sign to take off what the chain holds for it.";
      /** The rules after the owner removed one: it is not among them. */
      const without = (enforcement: object[], rule: object[] = []) =>
        body({
          rules: { mode: "whitelist", rules: rule, linked_only: false },
          enforcement,
        });
      /** What the backend keeps under the old id: behind, ready, with a total left. */
      const kept = (extra: object = {}) =>
        grant({
          state: "behind",
          ready: true,
          left: "5000000",
          note: NOTE,
          account: VAULT,
          signer: { family: "evm", address: ADMIN },
          ...extra,
        });
      const keptSol = (extra: object = {}) =>
        provider({
          state: "behind",
          ready: true,
          left: "2500000000",
          note: NOTE,
          account: OWNER,
          signer: { family: "svm", address: OWNER },
          ...extra,
        });
      const removedRows = () =>
        [
          ...document.querySelectorAll("[data-policy-removed]"),
        ] as HTMLElement[];
      const takeOff = (row: HTMLElement) =>
        act(async () => {
          fireEvent.click(
            within(row).getByRole("button", { name: "Sign to take off" }),
          );
        });

      it("lists it after the live policies as removed, with who holds it, what is left and why, and no remove or period", async () => {
        rules = without([kept()], [solRule()]);
        await renderPolicies();
        // The live policy is its own row; this one is not among them.
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toHaveTextContent("Up to 0.5 SOL on Jupiter");
        const [row] = removedRows();
        expect(removedRows()).toHaveLength(1);
        expect(row).toHaveTextContent("Removed · USDC on Uniswap");
        expect(within(row!).getByRole("img", { name: "Base" })).toBeTruthy();
        expect(row).toHaveTextContent("Onchain Enforcement:MetaMask");
        expect(
          within(row!).getByRole("link", { name: "MetaMask" }),
        ).toHaveAttribute("href", `https://basescan.org/address/${VAULT}`);
        expect(row).toHaveTextContent("· 5 USDC left");
        expect(row).toHaveTextContent(NOTE);
        expect(row).not.toHaveTextContent("Active period");
        expect(row).not.toHaveTextContent("Total not enforced");
        expect(row).not.toHaveTextContent("Out of date");
        expect(
          within(row!).queryByRole("button", { name: /Remove the policy/ }),
        ).toBeNull();
        expect(
          within(row!).getByRole("button", { name: "Sign to take off" }),
        ).toBeTruthy();
        expect(
          screen.queryByRole("button", { name: "Sign to deploy" }),
        ).toBeNull();
        expect(
          rows()[0]!.compareDocumentPosition(row!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });

      it("says which wallet to connect while another one is connected", async () => {
        rules = without([kept()]);
        await renderPolicies();
        const [row] = removedRows();
        expect(row).toHaveTextContent(/Connect 0xAbCd…Ef12 to sign\./);
        expect(
          within(row!).getByRole("button", { name: "Sign to take off" }),
        ).toBeDisabled();
      });

      it("is the only thing a wallet with no live policy shows besides No policies yet", async () => {
        rules = without([kept()]);
        const card = await renderPolicies();
        expect(rows()).toHaveLength(0);
        expect(card).toHaveTextContent("No policies yet.");
        expect(removedRows()).toHaveLength(1);
      });

      it("names a token and an app the catalog does not know by the raw asset and the id, and an address short", async () => {
        const asset =
          "eip155:8453/erc20:0xabcdef0000000000000000000000000000001234";
        rules = without([
          kept({ rule: `${asset}@protocol:zzzapp` }),
          kept({ rule: `${USDC}@address:${OTHER}` }),
        ]);
        await renderPolicies();
        const [unknown, address] = removedRows();
        expect(unknown).toHaveTextContent("Removed · 0xabcd…1234 on Zzzapp");
        // No decimals to read the chain's number by: it is shown as it is.
        expect(unknown).toHaveTextContent("· 5000000 0xabcd…1234 left");
        expect(address).toHaveTextContent("Removed · USDC to 0x1111…2222");
      });

      it("ignores a provider that is off, and an entry for a policy that is still there", async () => {
        rules = without([
          kept({ state: "off", ready: false, left: null, note: "Declined." }),
          kept({ rule: `${USDC}@any`, state: "off", ready: true, left: null }),
        ]);
        const card = await renderPolicies();
        expect(removedRows()).toHaveLength(0);
        expect(card).not.toHaveTextContent("Declined.");
        expect(card).toHaveTextContent("No policies yet.");
        cleanup();
        // The rule is current: its own row offers the deployment, not a removal.
        rules = withUsdc({ enforcement: [kept()] });
        await renderPolicies();
        expect(rows()).toHaveLength(1);
        expect(removedRows()).toHaveLength(0);
        expect(button("Sign to deploy")).toBeTruthy();
        expect(
          screen.queryByRole("button", { name: "Sign to take off" }),
        ).toBeNull();
      });

      it("takes a grant off with one revoking signature: prepare with remove, the wallet signs, confirm, and the row goes", async () => {
        kit.identity.address = ADMIN;
        kit.identity.chainId = 8453;
        rules = without([kept()], [solRule()]);
        answer(GRANT_STEP, typedAction, without([], [solRule()]));
        let release!: (signed: { signature: string }) => void;
        kit.signTypedData.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        );
        await renderPolicies();
        await takeOff(removedRows()[0]!);
        // The row says what is being signed, and does not promise a second
        // signature although the chain's entry is behind.
        expect(
          await screen.findByText(
            "You’re signing for: Take USDC on Uniswap (Base) off the chain. Check it in your wallet.",
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/two signatures/)).toBeNull();
        expect(button("Waiting for wallet…")).toBeDisabled();
        await act(async () => {
          release({ signature });
        });
        expect(kit.signTypedData).toHaveBeenCalledTimes(1);
        expect(kit.signTypedData).toHaveBeenCalledWith(
          expect.objectContaining({
            signer: ADMIN,
            chainId: 8453,
            description: "Remove policy from chain",
          }),
        );
        expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
        // The rule's old id, and remove: the backend takes that rule off.
        const step = {
          network: "eip155:8453",
          rule: USDC_RULE,
          revision: 3,
          owner: ADMIN,
          remove: true,
        };
        expect(writes().map((call) => call.body)).toEqual([
          step,
          { ...step, signature },
        ]);
        // The refreshed rules no longer carry the entry.
        await waitFor(() => expect(removedRows()).toHaveLength(0));
        expect(rows()).toHaveLength(1);
        expect(screen.queryByText(/You’re signing for/)).toBeNull();
      });

      it("takes a Solana role off with one transaction: prepare with remove, the wallet sends it, confirm, and the row goes", async () => {
        kit.identity.svmAddress = OWNER;
        rules = without([keptSol()], [usdcRule()]);
        answer(STEP, transaction, without([], [usdcRule()]));
        await renderPolicies();
        const [row] = removedRows();
        expect(row).toHaveTextContent("Removed · SOL on Jupiter");
        expect(within(row!).getByRole("img", { name: "Solana" })).toBeTruthy();
        expect(row).toHaveTextContent("Onchain Enforcement:Vault");
        expect(row).toHaveTextContent("· 2.5 SOL left");
        await takeOff(row!);
        await waitFor(() => expect(removedRows()).toHaveLength(0));
        expect(kit.signAndSendSolanaTransaction).toHaveBeenCalledTimes(1);
        expect(kit.signAndSendSolanaTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            unsignedTx: "AQAB",
            cluster: "solana:mainnet",
            description: "Remove policy from chain",
          }),
        );
        expect(kit.signTypedData).not.toHaveBeenCalled();
        // A transaction's confirm carries no signature.
        const step = {
          network: "solana:mainnet-beta",
          rule: SOL_RULE,
          revision: 3,
          owner: OWNER,
          remove: true,
        };
        expect(writes().map((call) => call.body)).toEqual([step, step]);
        expect(rows()).toHaveLength(1);
      });

      it("keeps the row and says what went wrong when the step fails, and when the owner declines", async () => {
        kit.identity.address = ADMIN;
        rules = without([kept()]);
        answer(GRANT_STEP, typedAction, without([]));
        kit.signTypedData.mockRejectedValueOnce(
          Object.assign(new Error("User rejected the request."), {
            code: 4001,
          }),
        );
        await renderPolicies();
        await takeOff(removedRows()[0]!);
        expect(
          await within(removedRows()[0]!).findByText(
            "Signature declined. Nothing changed.",
          ),
        ).toBeInTheDocument();
        expect(writes()).toHaveLength(1);
        respond = (method, path) =>
          method === "POST" && path === `${GRANT_STEP}/prepare`
            ? refused("rules_not_enforceable", 409)
            : undefined;
        await takeOff(removedRows()[0]!);
        expect(
          await within(removedRows()[0]!).findByText(
            "These policies can't go on chain yet.",
          ),
        ).toBeInTheDocument();
        expect(removedRows()).toHaveLength(1);
      });

      describe("the owner sends their own signed revocation", () => {
        const SENT_NOTE =
          "Your revocation is signed. Send it from your wallet to take the grant off chain, or wait for Aomi to send it where the network supports that.";
        const MANAGER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
        const sendAction = {
          kind: "evm_transaction",
          network: "eip155:8453",
          to: MANAGER,
          data: "0xcafe0001",
          value: "0x0",
        };
        const sendTo = (action: object, confirmed: object) => {
          respond = (method, path) => {
            if (method !== "POST") return undefined;
            if (path === `${GRANT_STEP}/prepare`)
              return Response.json({ action });
            if (path === `${GRANT_STEP}/confirm`)
              return Response.json({ rules: confirmed });
            return undefined;
          };
        };
        const send = (row: HTMLElement) =>
          act(async () => {
            fireEvent.click(
              within(row).getByRole("button", { name: "Send revocation" }),
            );
          });

        it("labels the step Send revocation, and says which wallet to connect while another is", async () => {
          rules = without([kept({ note: SENT_NOTE })]);
          await renderPolicies();
          const [row] = removedRows();
          expect(row).toHaveTextContent(SENT_NOTE);
          expect(row).toHaveTextContent(/Connect 0xAbCd…Ef12 to send\./);
          expect(
            within(row!).getByRole("button", { name: "Send revocation" }),
          ).toBeDisabled();
          expect(
            within(row!).queryByRole("button", { name: "Sign to take off" }),
          ).toBeNull();
        });

        it("sends it from the owner's wallet on the policy's chain, then confirms with no signature, and the row goes", async () => {
          kit.identity.address = ADMIN;
          kit.identity.chainId = 1;
          rules = without([kept({ note: SENT_NOTE })], [solRule()]);
          sendTo(sendAction, without([], [solRule()]));
          let release!: (result: { txHash: string }) => void;
          kit.sendTransaction.mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                release = resolve;
              }),
          );
          await renderPolicies();
          await send(removedRows()[0]!);
          expect(
            await screen.findByText(
              "You’re sending: Take USDC on Uniswap (Base) off the chain. Your wallet pays the network fee.",
            ),
          ).toBeInTheDocument();
          expect(button("Waiting for wallet…")).toBeDisabled();
          // The wallet moves to the policy's chain, then sends exactly the
          // prepared transaction, with no account abstraction and no value.
          expect(kit.switchChain).toHaveBeenCalledWith(8453);
          expect(kit.sendTransaction).toHaveBeenCalledTimes(1);
          expect(kit.sendTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
              chainId: 8453,
              to: MANAGER,
              data: "0xcafe0001",
              value: "0x0",
              aaPreference: "none",
            }),
            { chainIdAlreadySelected: 8453 },
          );
          expect(writes()).toHaveLength(1);
          await act(async () => {
            release({ txHash: "0xsent" });
          });
          // The rule's old id, and remove; confirm sends no signature.
          const step = {
            network: "eip155:8453",
            rule: USDC_RULE,
            revision: 3,
            owner: ADMIN,
            remove: true,
          };
          expect(writes().map((call) => call.body)).toEqual([step, step]);
          await waitFor(() => expect(removedRows()).toHaveLength(0));
          expect(rows()).toHaveLength(1);
          expect(kit.signTypedData).not.toHaveBeenCalled();
          expect(screen.queryByText(/You’re sending/)).toBeNull();
        });

        it("stays on the chain it is already on", async () => {
          kit.identity.address = ADMIN;
          kit.identity.chainId = 8453;
          rules = without([kept({ note: SENT_NOTE })]);
          sendTo(sendAction, without([]));
          await renderPolicies();
          await send(removedRows()[0]!);
          await waitFor(() => expect(removedRows()).toHaveLength(0));
          expect(kit.switchChain).not.toHaveBeenCalled();
          expect(kit.sendTransaction).toHaveBeenCalledTimes(1);
        });

        it("confirms again while the backend's node does not show the transaction yet, and says so when it never does", async () => {
          vi.useFakeTimers({ shouldAdvanceTime: true });
          try {
            kit.identity.address = ADMIN;
            kit.identity.chainId = 8453;
            const still = without([kept({ note: SENT_NOTE })]);
            rules = still;
            // The chain shows it on the third confirm.
            let confirms = 0;
            respond = (method, path) => {
              if (method !== "POST") return undefined;
              if (path === `${GRANT_STEP}/prepare`)
                return Response.json({ action: sendAction });
              if (path === `${GRANT_STEP}/confirm`) {
                confirms += 1;
                return Response.json({
                  rules: confirms < 3 ? still : without([]),
                });
              }
              return undefined;
            };
            await renderPolicies();
            await send(removedRows()[0]!);
            await act(async () => {
              await vi.advanceTimersByTimeAsync(5_000);
            });
            await waitFor(() => expect(removedRows()).toHaveLength(0));
            expect(confirms).toBe(3);
            expect(kit.sendTransaction).toHaveBeenCalledTimes(1);
            cleanup();
            // Never shown: the row stays and says the transaction was sent.
            rules = still;
            respond = (method, path) =>
              method === "POST"
                ? Response.json(
                    path === `${GRANT_STEP}/prepare`
                      ? { action: sendAction }
                      : { rules: still },
                  )
                : undefined;
            await renderPolicies();
            await send(removedRows()[0]!);
            await act(async () => {
              await vi.advanceTimersByTimeAsync(15_000);
            });
            expect(
              await within(removedRows()[0]!).findByText(
                /Your transaction was sent, but Aomi doesn’t see it on the chain yet/,
              ),
            ).toBeInTheDocument();
            expect(removedRows()).toHaveLength(1);
          } finally {
            vi.useRealTimers();
          }
        });

        it("keeps the row and shows the wallet's error when the send fails, and when the owner declines", async () => {
          kit.identity.address = ADMIN;
          kit.identity.chainId = 8453;
          rules = without([kept({ note: SENT_NOTE })]);
          sendTo(sendAction, without([]));
          kit.sendTransaction.mockRejectedValueOnce(
            new Error("wallet_sequential_transaction_reverted"),
          );
          await renderPolicies();
          await send(removedRows()[0]!);
          expect(
            await within(removedRows()[0]!).findByText(
              "wallet_sequential_transaction_reverted",
            ),
          ).toBeInTheDocument();
          expect(removedRows()).toHaveLength(1);
          // Nothing was confirmed, and the policies are read again.
          expect(writes()).toHaveLength(1);
          await waitFor(() => expect(reads("/rules")).toHaveLength(2));
          kit.sendTransaction.mockRejectedValueOnce(
            Object.assign(new Error("User rejected the request."), {
              code: 4001,
            }),
          );
          await send(removedRows()[0]!);
          expect(
            await within(removedRows()[0]!).findByText(
              "Signature declined. Nothing changed.",
            ),
          ).toBeInTheDocument();
          expect(writes()).toHaveLength(2);
          expect(removedRows()).toHaveLength(1);
        });

        it("refuses a send for another network than the entry's, and sends nothing", async () => {
          kit.identity.address = ADMIN;
          rules = without([kept({ note: SENT_NOTE })]);
          sendTo({ ...sendAction, network: "eip155:10" }, without([]));
          await renderPolicies();
          await send(removedRows()[0]!);
          expect(
            await screen.findByText(
              "Aomi asked for a signature on another network than this policy's. Nothing was signed.",
            ),
          ).toBeInTheDocument();
          expect(kit.sendTransaction).not.toHaveBeenCalled();
          expect(kit.switchChain).not.toHaveBeenCalled();
          expect(writes()).toHaveLength(1);
        });

        it("refuses a destination that is not a plain address, or value, and sends nothing", async () => {
          kit.identity.address = ADMIN;
          rules = without([kept({ note: SENT_NOTE })]);
          // The client's own parse refuses these first; the widget is a second wall.
          for (const [change, message] of [
            [{ to: "vitalik.eth" }, /action.to must be a 20-byte/],
            [{ to: "0x1234" }, /action.to must be a 20-byte/],
            [{ value: "0xde0b6b3a7640000" }, /Aomi asked to send funds/],
          ] as const) {
            sendTo({ ...sendAction, ...change }, without([]));
            await renderPolicies();
            await send(removedRows()[0]!);
            expect(await screen.findByText(message)).toBeInTheDocument();
            cleanup();
          }
          expect(kit.sendTransaction).not.toHaveBeenCalled();
        });

        it("refuses to send from a wallet that is not the one that owns the policy, or a Solana wallet", async () => {
          rules = without([kept({ note: SENT_NOTE })]);
          sendTo(sendAction, without([]));
          // Another EVM account is connected: the button is off, and a
          // forced run refuses.
          kit.identity.address = OTHER;
          await renderPolicies();
          expect(
            within(removedRows()[0]!).getByRole("button", {
              name: "Send revocation",
            }),
          ).toBeDisabled();
          cleanup();
          // The entry's signer is a Solana wallet: an EVM transaction is not its step.
          kit.identity.address = ADMIN;
          kit.identity.svmAddress = OWNER;
          rules = without([
            kept({
              note: SENT_NOTE,
              signer: { family: "svm", address: OWNER },
            }),
          ]);
          await renderPolicies();
          await send(removedRows()[0]!);
          expect(
            await screen.findByText("This wallet can't send that."),
          ).toBeInTheDocument();
          expect(kit.sendTransaction).not.toHaveBeenCalled();
          expect(writes()).toHaveLength(1);
        });

        it("refuses when the wallet cannot send transactions", async () => {
          kit.identity.address = ADMIN;
          rules = without([kept({ note: SENT_NOTE })]);
          sendTo(sendAction, without([]));
          const send = kit.sendTransaction;
          (kit as { sendTransaction?: unknown }).sendTransaction = undefined;
          try {
            await renderPolicies();
            await act(async () => {
              fireEvent.click(
                within(removedRows()[0]!).getByRole("button", {
                  name: "Send revocation",
                }),
              );
            });
            expect(
              await screen.findByText("This wallet can't send that."),
            ).toBeInTheDocument();
            expect(writes()).toHaveLength(1);
          } finally {
            (kit as { sendTransaction?: unknown }).sendTransaction = send;
          }
        });
      });

      it("offers nothing to sign where there is nothing to take off", async () => {
        rules = without([
          kept({ ready: false, state: "unverified", note: "Not readable." }),
        ]);
        await renderPolicies();
        const [row] = removedRows();
        expect(row).toHaveTextContent("Not verified");
        expect(row).toHaveTextContent("Not readable.");
        expect(
          within(row!).queryByRole("button", { name: "Sign to take off" }),
        ).toBeNull();
      });
    });
  });

  describe("a waiting change", () => {
    it("shows every wallet's change at the top, and Later leaves one line with Review or Decline", async () => {
      rules = body({
        pending: change({ proposed_by: "agent:telegram:7712345678" }),
      });
      await renderPolicies();
      const card = await changeCard();
      expect(card).toHaveTextContent("expires in 23 h");
      fireEvent.click(within(card).getByRole("button", { name: "Later" }));
      const line = document.querySelector(
        "[data-pending-change]",
      ) as HTMLElement;
      expect(line).toHaveTextContent(
        "Trading wallet · Aomi asks: USDC on Base: 200 → 400",
      );
      expect(line).toHaveTextContent("23 h left");
      expect(document.querySelector("[data-rule-change]")).toBeNull();
      fireEvent.click(within(line).getByRole("button", { name: "Review" }));
      fireEvent.click(
        within(await changeCard()).getByRole("button", { name: "Later" }),
      );
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
      await renderPolicies();
      fireEvent.click(
        within(await changeCard()).getByRole("button", { name: "Later" }),
      );
      expect(document.querySelector("[data-pending-change]")).toHaveTextContent(
        "Waiting for approval: USDC on Base: 200 → 400",
      );
    });

    it("approves with the session and shows the policies after it", async () => {
      rules = body({ pending: change() });
      await renderPolicies();
      respond = (method) => {
        if (method !== "POST") return undefined;
        rules = body({
          revision: 4,
          rules: {
            mode: "blacklist",
            rules: [usdcRule({ amount: "400000000" })],
            linked_only: false,
          },
        });
        return Response.json(rules);
      };
      fireEvent.click(
        within(await changeCard()).getByRole("button", { name: "Approve" }),
      );
      expect(await screen.findByText("Approved.")).toBeTruthy();
      expect(rows()[0]).toHaveTextContent("Up to 400 USDC on Uniswap");
      expect(writes()).toEqual([
        {
          method: "POST",
          path: "/v1/account/rule-changes/ch-1/approve",
          body: {},
        },
      ]);
      expect(document.querySelector("[data-rule-change]")).toBeNull();
    });

    it("stops offering a decision the moment the change expires", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const soon = Math.floor(Date.now() / 1000) + 20;
        rules = body({ pending: change({ expires_at: soon }) });
        await renderPolicies();
        const card = await changeCard();
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

    it("asks the admin wallet to sign the exact message and sends its signature", async () => {
      kit.identity.address = ADMIN.toLowerCase();
      kit.wallets = [
        {
          family: "evm",
          address: ADMIN,
          kind: "external",
          connected: true,
          label: "Ledger",
        },
      ];
      rules = body({
        admin: { kind: "wallet", family: "evm", address: ADMIN },
        pending: change({
          signer: { kind: "wallet", family: "evm", address: ADMIN },
          sign_message: "Aomi rule change ch-1\nUSDC on Base: 200 → 400",
        }),
      });
      await renderPolicies();
      const card = await changeCard();
      expect(card).toHaveTextContent(
        "Only Ledger (0xAbCd…Ef12) can approve this. Aomi can't.",
      );
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      respond = (method) => {
        if (method !== "POST") return undefined;
        rules = body({ admin: rules.admin });
        return Response.json(rules);
      };
      fireEvent.click(screen.getByRole("button", { name: "Sign in wallet" }));
      expect(await screen.findByText("Approved.")).toBeTruthy();
      expect(kit.signMessage).toHaveBeenCalledWith({
        non_typed_data: "Aomi rule change ch-1\nUSDC on Base: 200 → 400",
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
      await renderPolicies();
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
      await renderPolicies();
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

    it("says the wallet signed when sending the signature fails", async () => {
      kit.identity.address = ADMIN;
      rules = body({
        admin: { kind: "wallet", family: "evm", address: ADMIN },
        pending: change({
          signer: { kind: "wallet", family: "evm", address: ADMIN },
          sign_message: "Aomi rule change ch-1",
        }),
      });
      await renderPolicies();
      respond = (method) => {
        if (method === "POST") throw new TypeError("network down");
        return undefined;
      };
      fireEvent.click(screen.getByRole("button", { name: "Sign in wallet" }));
      expect(
        await screen.findByText(
          "Your wallet signed, but the change couldn’t be sent. Check the policies before trying again.",
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

    it("asks an old sign-in to sign in again before approving", async () => {
      rules = body({ pending: change() });
      await renderPolicies();
      respond = (method) =>
        method === "POST" ? refused("login_stale", 403) : undefined;
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(
        await screen.findByText("For a policy change, sign in again."),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
      await waitFor(() => expect(kit.signOutAccount).toHaveBeenCalledTimes(1));
      // The change is still waiting.
      expect(document.querySelector("[data-rule-change]")).toBeTruthy();
    });

    it("reads the policies again when the change was already decided", async () => {
      rules = body({ pending: change() });
      await renderPolicies();
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
      expect(reads("/rules")).toHaveLength(2);
    });
  });
});

describe("Settings › Policies › vault", () => {
  const vaultEntry = (extra: object = {}) =>
    provider({
      rule: USDC_RULE,
      provider: "metamask",
      name: "MetaMask",
      network: "eip155:8453",
      state: "on",
      ready: false,
      left: "200000000",
      account: VAULT,
      signer: { family: "evm", address: ADMIN },
      ...extra,
    });
  const withVault = (enforcement: object[]) => {
    rules = body({ enforcement });
  };
  const vaults = () =>
    [...document.querySelectorAll("[data-vault]")] as HTMLElement[];
  const vaultBalances = (row: HTMLElement) =>
    within(row).findByText("USDC 95.00 · ETH 0.98");
  // r, s and v of a signature the vault could use.
  const usable = `0x${"11".repeat(32)}${"11".repeat(32)}1b`;

  it("shows one row for a wallet's MetaMask vault, with its balances read from the chain", async () => {
    // Two rules on one vault, one removed: still one vault.
    withVault([
      vaultEntry(),
      vaultEntry({ rule: `${USDC}@protocol:aerodrome`, state: "behind" }),
    ]);
    const card = await renderPolicies();
    const [row] = vaults();
    expect(vaults()).toHaveLength(1);
    expect(card.contains(row!)).toBe(true);
    await vaultBalances(row!);
    expect(row).toHaveTextContent("Vault");
    expect(within(row!).getByRole("img")).toHaveAttribute("aria-label", "Base");
    expect(chain.balances).toHaveBeenCalledTimes(1);
    expect(chain.balances).toHaveBeenCalledWith(8453, VAULT, [
      {
        symbol: "USDC",
        decimals: 6,
        asset: { erc20: USDC.split("erc20:")[1] },
      },
      { symbol: "ETH", decimals: 18, asset: { native: true } },
    ]);
    // After the policy rows, before who may change them.
    expect(
      row!.compareDocumentPosition(
        card.querySelector("[data-policy-authority]")!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows none for a wallet with no MetaMask vault: another provider, or a chain no withdrawal is built for", async () => {
    withVault([
      provider({ account: OWNER }),
      vaultEntry({ network: "eip155:42161" }),
      vaultEntry({ account: null }),
    ]);
    await renderPolicies();
    expect(vaults()).toHaveLength(0);
    expect(chain.balances).not.toHaveBeenCalled();
  });

  it("withdraws: the owner's wallet goes to the vault's chain, signs, then sends to the DelegationManager, and nothing goes to Aomi", async () => {
    kit.identity.address = ADMIN.toLowerCase();
    kit.identity.chainId = 1;
    kit.signTypedData.mockImplementationOnce(async () => ({
      signature: usable,
    }));
    withVault([vaultEntry()]);
    await renderPolicies();
    const [row] = vaults();
    await vaultBalances(row!);
    fireEvent.click(within(row!).getByRole("button", { name: "Withdraw" }));
    fireEvent.change(within(row!).getByRole("textbox", { name: "Amount" }), {
      target: { value: "12.5" },
    });
    const before = calls.length;
    chain.balances.mockImplementation(async (_chain, _vault, tokens) =>
      (tokens as VaultHolding["token"][]).map((token) => ({
        token,
        raw:
          "native" in token.asset
            ? BigInt("980000000000000000")
            : BigInt(82_500_000),
      })),
    );
    await act(async () => {
      fireEvent.click(
        within(row!).getByRole("button", { name: "Sign and send" }),
      );
    });
    expect(await within(row!).findByText("Withdrawn.")).toBeInTheDocument();
    expect(chain.hasCode).toHaveBeenCalledWith(8453, VAULT);
    expect(kit.switchChain).toHaveBeenCalledWith(8453);
    expect(kit.signTypedData).toHaveBeenCalledTimes(1);
    expect(kit.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: ADMIN.toLowerCase(),
        chainId: 8453,
        typed_data: expect.objectContaining({
          primaryType: "Delegation",
          domain: expect.objectContaining({
            chainId: 8453,
            verifyingContract: DELEGATION_MANAGER,
          }),
          message: expect.objectContaining({
            delegate: ADMIN.toLowerCase(),
            delegator: VAULT,
          }),
        }),
      }),
    );
    expect(kit.sendTransaction).toHaveBeenCalledTimes(1);
    expect(kit.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        aaPreference: "none",
        chainId: 8453,
        to: DELEGATION_MANAGER,
        value: "0x0",
      }),
      { chainIdAlreadySelected: 8453 },
    );
    await within(row!).findByText("USDC 82.50 · ETH 0.98");
    // Nothing was stored or sent to the backend by the withdrawal.
    expect(calls.slice(before).filter((call) => call.method !== "GET")).toEqual(
      [],
    );
  });

  it("disables Withdraw, naming the owner's wallet, when another wallet is connected", async () => {
    kit.identity.address = OTHER;
    withVault([vaultEntry()]);
    await renderPolicies();
    const [row] = vaults();
    await vaultBalances(row!);
    expect(
      within(row!).getByRole("button", { name: "Withdraw" }),
    ).toBeDisabled();
    expect(row).toHaveTextContent("Connect 0xabcd…ef12 to sign.");
    expect(kit.signTypedData).not.toHaveBeenCalled();
  });
});
