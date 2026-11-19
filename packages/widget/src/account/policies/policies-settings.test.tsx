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
type Row = Record<string, string | boolean>;
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
// The chain is never read: vault rows get this fake reader.
const holdings = (usdc: number) =>
  vi.fn(async (_chain: number, _vault: string, tokens: readonly unknown[]) =>
    (tokens as VaultHolding["token"][]).map((token) => ({
      token,
      raw:
        "native" in token.asset ? BigInt("980000000000000000") : BigInt(usdc),
    })),
  );
const chain = {
  hasCode: vi.fn(async (_chain: number, _vault: string) => true),
  balances: holdings(95_000_000),
};
vi.mock("./vault-chain", () => ({
  viemVaultReader: (): VaultReader => chain,
}));

const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OP_USDC = "eip155:10/erc20:0x0b2c639c533813f4aa9d7837caf62653d097ff85";
const SOL = "solana:mainnet-beta/native";
const USDC_RULE = `${USDC}@protocol:uniswap`;
const SOL_RULE = `${SOL}@protocol:jupiter`;
const FRIEND = "0x00000000000000000000000000000000000000aa";
const VAULT = "0x00000000000000000000000000000000000000a1";
const WALLET = { id: "g-trading", name: "Trading wallet" };
const STEP = `/v1/account/agent-wallets/${WALLET.id}/rules/enforcement/vault`;
const GRANT_STEP = `/v1/account/agent-wallets/${WALLET.id}/rules/enforcement/metamask`;
const NETWORK_REFUSED =
  "Aomi asked for a signature on another network than this policy's. Nothing was signed.";
const DECLINED = "Signature declined. Nothing changed.";
const NOT_ENFORCEABLE = "These policies can't go on chain yet.";
const signature = `0x${"ab".repeat(65)}`;
const hours = (count: number) =>
  Math.floor(Date.now() / 1000) + count * 3600 + 600;
const FROM = Math.floor(Date.now() / 1000) - 7 * 86_400;
const day = (seconds: number) => policyDay(localDay(seconds));
const declined = () =>
  Object.assign(new Error("User rejected the request."), { code: 4001 });

const agentWallet = (id: string, name: string, archived_at: number | null) => ({
  id,
  name,
  archived_at,
  paused: false,
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
const SOL_HELD = {
  asset: SOL,
  amount: "500000000",
  to: { kind: "protocol", id: "jupiter" },
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
  ...SOL_HELD,
  id: SOL_RULE,
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
/** A whitelist holding exactly `list`. */
const allow = (list: object[], extra: object = {}) =>
  body({
    rules: { mode: "whitelist", rules: list, linked_only: false },
    ...extra,
  });
const withSol = (extra: object = {}) => allow([solRule()], extra);
const withUsdc = (extra: object = {}) => allow([usdcRule()], extra);
/** One provider's entry for one rule: the Solana vault, off, ready to sign. */
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
/** A rule held by a signed MetaMask grant on Base. */
const grant = (extra: object = {}) =>
  provider({
    rule: USDC_RULE,
    provider: "metamask",
    name: "MetaMask",
    network: "eip155:8453",
    signer: { family: "evm", address: null },
    ...extra,
  });
const stepBody = (network: string, rule: string, owner: string, more = {}) => ({
  network,
  rule,
  revision: 3,
  owner,
  ...more,
});
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
  // Above 2^53, so the backend sends decimal strings.
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
let respond: (method: string, path: string) => Response | undefined;
const writes = () => calls.filter((call) => call.method !== "GET");
const sentBodies = () => writes().map((call) => call.body);
const reads = (path: string) =>
  calls.filter((call) => call.method === "GET" && call.path.endsWith(path));
const refused = (error: string, status: number) =>
  Response.json({ error }, { status });
const onPost = (reply: () => Response) => {
  respond = (method) => (method === "POST" ? reply() : undefined);
};
const applied = () => onPost(() => Response.json({ status: "applied", rules }));
/** What a provider answers to prepare and confirm. */
const answer = (step: string, action: unknown, confirmed: object) => {
  respond = (method, path) => {
    if (method !== "POST") return undefined;
    if (path === `${step}/prepare`) return Response.json({ action });
    if (path === `${step}/confirm`) return Response.json({ rules: confirmed });
    return undefined;
  };
};
const refuseStep = (step: string) => {
  respond = (method, path) =>
    method === "POST" && path === `${step}/prepare`
      ? refused("rules_not_enforceable", 409)
      : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  rules = body();
  wallets = [
    agentWallet(WALLET.id, WALLET.name, null),
    agentWallet("g-old", "Old", 1_760_000_100),
  ];
  respond = () => undefined;
  Object.assign(kit.identity, {
    address: undefined,
    svmAddress: undefined,
    chainId: 1,
  });
  kit.wallets = [];
  chain.balances = holdings(95_000_000);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://portal.test");
      const method = init?.method ?? "GET";
      const sent = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: url.pathname, body: sent });
      const reply = respond(method, url.pathname);
      if (reply) return reply;
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

const mount = () =>
  act(async () => {
    render(<PoliciesSettings />, { wrapper: AccountOverviewFixture });
  });
async function renderPolicies() {
  await mount();
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
const removedRows = () =>
  [...document.querySelectorAll("[data-policy-removed]")] as HTMLElement[];
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const click = (name: string | RegExp, scope: HTMLElement = document.body) =>
  act(async () => {
    fireEvent.click(within(scope).getByRole("button", { name }));
  });
const flip = (name: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole("switch", { name }));
  });
const see = async (text: string | RegExp, scope?: HTMLElement) =>
  expect(
    await (scope ? within(scope) : screen).findByText(text),
  ).toBeInTheDocument();
const has = (el: Element | undefined, ...texts: (string | RegExp)[]) => {
  for (const text of texts) expect(el).toHaveTextContent(text);
};
const lacks = (el: Element | undefined, ...texts: (string | RegExp)[]) => {
  for (const text of texts) expect(el).not.toHaveTextContent(text);
};
const noButton = (name: string, scope: HTMLElement = document.body) =>
  expect(within(scope).queryByRole("button", { name })).toBeNull();
const changeCard = () =>
  screen.findByRole("region", { name: "Policy change for Trading wallet" });
const submit = () => click("Policy");
const sign = () => click("Sign to deploy");
const after = (a: Node, b: Node) =>
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
/** Holds a mock's next call open until the returned function resolves it. */
function hold<T>(mock: {
  mockImplementationOnce(fn: () => Promise<T>): unknown;
}) {
  let release!: (value: T) => void;
  mock.mockImplementationOnce(
    () => new Promise<T>((resolve) => (release = resolve)),
  );
  return (value: T) =>
    act(async () => {
      release(value);
    });
}
const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), {
    target: { value },
  });
const useAddress = (address: string) => {
  type("Send to address", address);
  fireEvent.click(button("Use address"));
};
type To = string | { address: string };
/** Open the picker and fill `token / amount / chain / to` as a person does. */
async function fillPolicy(
  token: string,
  amount: string,
  to: To,
  chains: string[] = [],
) {
  if (!document.querySelector("[data-policy-picker]"))
    fireEvent.click(button("Policy"));
  fireEvent.click(await screen.findByRole("button", { name: token }));
  type("Total amount", amount);
  for (const chain of chains) fireEvent.click(button(chain));
  if (chains.length) fireEvent.click(button("Next"));
  if (typeof to === "string") fireEvent.click(button(to));
  else useAddress(to.address);
}
const openUsdcOn = async (...chains: string[]) => {
  fireEvent.click(button("Policy"));
  fireEvent.click(await screen.findByRole("button", { name: "USDC" }));
  for (const chain of chains) fireEvent.click(button(chain));
  fireEvent.click(button("Next"));
};

describe("Settings › Policies", () => {
  it("lists each live agent wallet with its switches, policies and authority, and counts no spend", async () => {
    const card = await renderPolicies();
    for (const name of [
      "Only allow transfers to linked wallet",
      "Only allow policy-defined actions",
    ])
      expect(within(card).getByRole("switch", { name })).not.toBeChecked();
    const [row] = rows();
    has(card, "Not enforceable on chain.");
    has(
      row,
      "Up to 200 USDC on Uniswap",
      `Active period: Always on, since ${day(FROM)}`,
      "Onchain Enforcement:None",
      "Total not enforced",
    );
    expect(within(row!).getByRole("img", { name: "Base" })).toBeInTheDocument();
    lacks(card, /a day|used/);
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(
      within(card).getByRole("radio", { name: "Self-approval" }),
    ).toBeChecked();
    // An archived wallet is neither shown nor read.
    expect(screen.queryByRole("region", { name: "Old policies" })).toBeNull();
    expect(calls.some((call) => call.path.includes("g-old"))).toBe(false);
    expect(reads("/rules/catalog")).toHaveLength(1);
  });

  it("offers Try again when a wallet's policies cannot be read, and says when there is no wallet", async () => {
    respond = (_method, path) =>
      path.endsWith("/rules") ? refused("internal_error", 500) : undefined;
    await mount();
    await see("Couldn’t load the policies.");
    respond = () => undefined;
    fireEvent.click(button("Try again"));
    await see("Policy change authority");
    cleanup();
    wallets = [];
    await mount();
    await see(/No agent wallets yet/);
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

  it("turns the two switches into the mode and the sends flag, each as the full set, and rereads on a conflict", async () => {
    applied();
    await renderPolicies();
    await flip("Only allow policy-defined actions");
    // The held rule goes back without what the server fills in.
    expect(sentRules(0)).toEqual({
      mode: "whitelist",
      rules: [HELD],
      linked_only: false,
    });
    await see("Saved.");
    await flip("Only allow transfers to linked wallet");
    expect(sentRules(1)).toEqual({
      mode: "blacklist",
      rules: [HELD],
      linked_only: true,
    });
    onPost(() => refused("rules_changed", 409));
    const before = reads("/rules").length;
    await flip("Only allow policy-defined actions");
    await see("The policies changed. Review them again.");
    await waitFor(() => expect(reads("/rules").length).toBeGreaterThan(before));
  });

  it("shows a whitelist as the switch turned on, and a wallet the agent stopped", async () => {
    rules = body({
      rules: { mode: "whitelist", rules: [usdcRule()], linked_only: true },
      stopped_until: hours(5),
    });
    const card = await renderPolicies();
    const name = "Only allow policy-defined actions";
    expect(within(card).getByRole("switch", { name })).toBeChecked();
    has(
      card,
      "The agent can do only what a policy lists.",
      "Stopped by the agent until 00:00 UTC",
    );
    await flip(name);
    expect(sentRules(0).mode).toBe("blacklist");
  });

  it("adds a policy as the full set with no server fields, sending an active period as the end of the chosen local day", async () => {
    applied();
    await renderPolicies();
    await fillPolicy("SOL", "1", "Any protocol");
    fireEvent.click(button("Set active period"));
    fireEvent.click(button("1 week"));
    await see(`through ${policyDay(dayFromToday(7))}`);
    await submit();
    const week = endOfLocalDay(dayFromToday(7));
    expect(sentRules(0)).toEqual({
      mode: "blacklist",
      rules: [
        HELD,
        {
          asset: SOL,
          amount: "1000000000",
          to: { kind: "any_protocol" },
          active_until: week,
        },
      ],
      linked_only: false,
    });
    expect(new Date(week * 1000).getHours()).toBe(23);
    await see("Saved.");
    expect(document.querySelector("[data-policy-picker]")).toBeNull();

    await fillPolicy("SOL", "2", "Kamino");
    fireEvent.click(button("Set active period"));
    await submit();
    await see("Pick how long the policy is active, or remove the period.");
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

  it("asks for what is missing before it sends anything, and says when the end is not in the future", async () => {
    await renderPolicies();
    fireEvent.click(button("Policy"));
    await submit();
    await see("Fill in the token, amount, chain and to.");
    fireEvent.click(await screen.findByRole("button", { name: "SOL" }));
    fireEvent.click(button("Jupiter"));
    await submit();
    await see("Enter an amount. 0 blocks the token there.");
    expect(writes()).toHaveLength(0);
    onPost(() => refused("rules_period_invalid", 400));
    type("Total amount", "1");
    await submit();
    await see("Pick an end date in the future.");
  });

  it("adds one policy on each picked chain in one change, offering only what every chain has", async () => {
    applied();
    await renderPolicies();
    await openUsdcOn("Base");
    const list = () =>
      within(
        screen.getByRole("group", { name: "To: a protocol, or an address" }),
      );
    expect(list().getByRole("button", { name: "Aerodrome" })).toBeTruthy();
    expect(list().queryByRole("button", { name: "Jupiter" })).toBeNull();
    expect(screen.getByRole("link", { name: /0x8335…2913/ })).toHaveAttribute(
      "href",
      "https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    );
    fireEvent.click(button("Aerodrome"));
    // A second chain drops a destination it does not have.
    fireEvent.click(button("Chain"));
    fireEvent.click(button("OP"));
    fireEvent.click(button("Next"));
    expect(list().queryByRole("button", { name: "Aerodrome" })).toBeNull();
    expect(button("To")).toHaveTextContent("to");
    fireEvent.click(list().getByRole("button", { name: "Uniswap" }));
    type("Total amount", "1000");
    await submit();
    expect(writes()).toHaveLength(1);
    // Base already had USDC on Uniswap: its amount is replaced.
    expect(sentRules(0).rules).toEqual([
      { ...HELD, amount: "1000000000" },
      { ...HELD, asset: OP_USDC, amount: "1000000000" },
    ]);
  });

  it("opens the waiting change at the top when a save gives the agent more", async () => {
    onPost(() =>
      Response.json({ status: "waiting", rules: body({ pending: change() }) }),
    );
    await renderPolicies();
    await fillPolicy("USDC", "400", "Uniswap", ["Base"]);
    await submit();
    expect(sentRules(0).rules).toEqual([{ ...HELD, amount: "400000000" }]);
    const card = await changeCard();
    has(card, "Policy change · Trading wallet", "USDC on Base: 200 → 400");
    await see("Waiting for approval.");
    after(
      card,
      screen.getByRole("region", { name: "Trading wallet policies" }),
    );
    await click("Later", card);
    has(
      document.querySelector("[data-pending-change]")!,
      "Waiting for approval: USDC on Base: 200 → 400",
    );
  });

  it("adds a policy for a send to one address, and refuses one that is not of the chain", async () => {
    applied();
    await renderPolicies();
    await openUsdcOn("Base");
    useAddress("HZpj1111111111111111111111111111111111PvRpW");
    await see("That isn’t an address on Base.");
    expect(writes()).toHaveLength(0);
    useAddress(FRIEND);
    type("Total amount", "20");
    await submit();
    expect(sentRules(0).rules[1]).toEqual({
      asset: USDC,
      amount: "20000000",
      to: { kind: "address", address: FRIEND },
    });
  });

  it("takes no address across chains that write them differently", async () => {
    const asset =
      "solana:mainnet-beta/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    catalog.tokens.push({
      asset,
      symbol: "USDC",
      decimals: 6,
      chain: "Solana",
    });
    try {
      await renderPolicies();
      await openUsdcOn("Base", "Solana");
      await see("One address can’t be used across these chains.");
      expect(
        screen.queryByRole("textbox", { name: "Send to address" }),
      ).toBeNull();
    } finally {
      catalog.tokens.pop();
    }
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
    const [merged, sol] = rows();
    expect(rows()).toHaveLength(2);
    has(merged, "Up to 200 USDC on Uniswap");
    expect(
      within(merged!)
        .getAllByRole("img")
        .map((mark) => mark.getAttribute("aria-label")),
    ).toEqual(["Base", "OP"]);
    has(sol, "Up to 0.5 SOL on Jupiter");
    await click("Remove the policy for USDC on Uniswap");
    expect(writes()).toHaveLength(1);
    expect(sentRules(0)).toEqual({
      mode: "blacklist",
      rules: [SOL_HELD],
      linked_only: false,
    });
  });

  it("says a zero total blocks, and keeps an ended policy listed as ended", async () => {
    const ended = Math.floor(Date.now() / 1000) - 86_400;
    const until = hours(24 * 20);
    const any = { kind: "any_protocol" };
    rules = allow([
      usdcRule({ amount: "0" }),
      solRule({ active_until: ended }),
      solRule({ id: `${SOL}@any`, to: any, active_until: until }),
    ]);
    applied();
    await renderPolicies();
    const [blocked, over, open] = rows();
    has(blocked, "No USDC on Uniswap");
    lacks(blocked, "Total not enforced");
    expect(over).toHaveAttribute("data-ended", "true");
    has(over, `Ended ${day(ended)}`);
    lacks(over, "Active period");
    expect(open).not.toHaveAttribute("data-ended");
    has(
      open,
      `Active period: ${day(FROM)} – ${day(until)}`,
      "Up to 0.5 SOL on any protocol",
    );
    // A write keeps each rule's end, and never sends its start.
    await click("Remove the policy for USDC on Uniswap");
    expect(sentRules(0).rules).toEqual([
      { ...SOL_HELD, active_until: ended },
      { ...SOL_HELD, to: any, active_until: until },
    ]);
  });

  it("offers Try again in the picker when the catalog cannot be read", async () => {
    let fail = true;
    respond = (_method, path) =>
      path.endsWith("/rules/catalog") && fail
        ? refused("internal_error", 500)
        : undefined;
    await renderPolicies();
    fireEvent.click(button("Policy"));
    await see("Couldn’t load the list.");
    fail = false;
    await click("Try again");
    expect(await screen.findByRole("button", { name: "USDC" })).toBeTruthy();
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
      const line = "Admin: Aomi-managed → wallet 0xAbCd…Ef12";
      onPost(() =>
        Response.json({
          status: "waiting",
          rules: body({
            pending: change({ lines: [{ text: line, loosens: false }] }),
          }),
        }),
      );
      const card = await renderPolicies();
      const pick = (name: string) => within(card).getByRole("radio", { name });
      const group = { name: "Wallet that approves changes" };
      expect(pick("Self-approval")).toBeChecked();
      expect(within(card).queryByRole("radiogroup", group)).toBeNull();
      fireEvent.click(pick("Selected wallet"));
      const options = within(
        within(card).getByRole("radiogroup", group),
      ).getAllByRole("radio");
      expect(options).toHaveLength(1);
      has(options[0], "Para", "0xAbCd…Ef12 · you@example.com · EVM");
      expect(options[0]).toBeChecked();
      has(
        card,
        "Only a signed-in wallet can change policy. Sign in with Privy to use a Privy wallet.",
      );
      expect(writes()).toHaveLength(0);
      fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
      expect(pick("Self-approval")).toBeChecked();
      fireEvent.click(pick("Selected wallet"));
      await click("Save", card);
      expect(writes()[0]!.body).toEqual({
        admin: { kind: "wallet", family: "evm", address: ADMIN },
      });
      // A new authority is itself a change that waits.
      has(await changeCard(), line);
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
      const radio = (name: string | RegExp) =>
        within(card).getByRole("radio", { name });
      expect(radio("Selected wallet")).toBeChecked();
      expect(radio(/0xAbCd…Ef12/)).toBeChecked();
      fireEvent.click(radio("Self-approval"));
      await click("Save", card);
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
    const STARTS = "It starts when you sign its deployment.";
    const sol = ["SOL", "0.3", "Jupiter"];
    const usdc = ["USDC", "10", "Uniswap", ["Base"]];
    const hint = () =>
      (document.querySelector("[data-policy-picker]")!.textContent ?? "")
        .replace(/\s+/g, " ")
        .replace("Enforcement: ", "Enforcement:");

    it.each([
      {
        name: "names Swig for Solana, which holds the destination too",
        providers: [SWIG, METAMASK],
        fill: sol,
        has: ["Onchain Enforcement:Swig", STARTS],
        lacks: ["Aomi alone checks", "None"],
      },
      {
        name: "says None, and what Aomi checks, where no provider covers the network",
        providers: [SWIG],
        fill: usdc,
        has: [
          "Onchain Enforcement:None",
          "Aomi checks the destination and period; the total isn’t enforced.",
        ],
      },
      {
        name: "names MetaMask on Base, and says Aomi alone checks an app",
        providers: [SWIG, METAMASK],
        fill: usdc,
        has: [
          "Onchain Enforcement:MetaMask",
          STARTS,
          "MetaMask holds the total and period on chain; Aomi alone checks the destination.",
        ],
      },
      {
        name: "leaves that out for an address, which MetaMask holds whole",
        providers: [METAMASK],
        fill: ["USDC", "10", { address: FRIEND }, ["Base"]],
        has: ["Onchain Enforcement:MetaMask"],
        lacks: ["Aomi alone checks"],
      },
      {
        name: "keeps nothing-goes-on-chain wording with the allow-list switch off",
        providers: [SWIG, METAMASK],
        blacklist: true,
        fill: sol,
        has: [
          "Onchain Enforcement:None",
          "With the switch off nothing goes on chain: a block works, a total isn’t enforced.",
        ],
        lacks: ["starts when you sign"],
      },
    ])("$name", async ({ providers, blacklist, fill, ...want }) => {
      const extra = providers ? { providers } : {};
      rules = blacklist ? body(extra) : allow([], extra);
      await renderPolicies();
      await fillPolicy(...(fill as Parameters<typeof fillPolicy>));
      for (const text of want.has) expect(hint()).toContain(text);
      for (const text of want.lacks ?? []) expect(hint()).not.toContain(text);
    });
  });

  describe("on-chain enforcement", () => {
    it.each([
      {
        entry: { ready: false, note: "Swig cannot hold this rule." },
        has: ["Onchain Enforcement:None", "Total not enforced"],
      },
      {
        entry: {
          state: "unverified",
          ready: false,
          note: "The chain could not be read.",
        },
        has: ["Not verified"],
      },
      {
        // The chain holds an older version: only the owning wallet may sign.
        entry: {
          state: "behind",
          note: "Your rules changed since you signed.",
          signer: { family: "svm", address: OWNER },
        },
        has: [
          "Onchain Enforcement:Vault",
          "Out of date",
          "Connect 4Nd1mB…DB4T to sign.",
        ],
        disabled: true,
      },
    ])("says why it cannot sign: $entry.note", async (want) => {
      rules = withSol({ enforcement: [provider(want.entry)] });
      await renderPolicies();
      has(rows()[0], ...want.has, want.entry.note);
      if (want.disabled) expect(button("Sign to deploy")).toBeDisabled();
      else noButton("Sign to deploy");
    });

    it("deploys with one signature: prepare, the wallet sends the transaction, confirm", async () => {
      kit.identity.svmAddress = OWNER;
      rules = allow([solRule({ active_from: undefined })], {
        enforcement: [provider()],
      });
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
      has(
        rows()[0],
        "Active period: always on, starts when you sign",
        "Onchain Enforcement:Vault",
      );
      lacks(rows()[0], "Total not enforced");
      await sign();
      // On chain, the name links to the holding account, with what is left.
      expect(
        await within(rows()[0]!).findByRole("link", { name: "Vault" }),
      ).toHaveAttribute("href", `https://solscan.io/account/${OWNER}`);
      has(rows()[0], "· 0.5 SOL left");
      noButton("Sign to deploy");
      expect(kit.signAndSendSolanaTransaction).toHaveBeenCalledTimes(1);
      expect(kit.signAndSendSolanaTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          unsignedTx: "AQAB",
          cluster: "solana:mainnet",
        }),
      );
      expect(kit.signTypedData).not.toHaveBeenCalled();
      // The rule's own id, never a policy; a transaction's confirm has no signature.
      const step = stepBody("solana:mainnet-beta", SOL_RULE, OWNER);
      expect(sentBodies()).toEqual([step, step]);
    });

    it("signs each rule on its own: the second rule's button runs the second rule", async () => {
      kit.identity.svmAddress = OWNER;
      const any = `${SOL}@any`;
      rules = allow(
        [solRule(), solRule({ id: any, to: { kind: "any_protocol" } })],
        {
          enforcement: [
            provider({ state: "on", ready: false, left: "400000000" }),
            provider({ rule: any }),
          ],
        },
      );
      answer(STEP, transaction, rules);
      await renderPolicies();
      expect(rows()).toHaveLength(2);
      has(rows()[0], "· 0.4 SOL left");
      noButton("Sign to deploy", rows()[0]);
      await click("Sign to deploy", rows()[1]);
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
      const release = hold(kit.signTypedData);
      await sign();
      await see(
        "You’re signing for: Up to 200 USDC on Uniswap (Base), with no end date. Check it in your wallet.",
      );
      expect(button("Waiting for wallet…")).toBeDisabled();
      await release({ signature });
      // Moved to Base; numbers read as the integers the types declare.
      expect(kit.switchChain).toHaveBeenCalledWith(8453);
      expect(kit.signTypedData).toHaveBeenCalledTimes(1);
      expect(kit.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          signer: ADMIN.toLowerCase(),
          chainId: 8453,
          typed_data: {
            ...typedData,
            message: {
              delegate: AGENT,
              cap: BigInt("123456789012345678901234567890"),
              caveats: [{ limit: BigInt("9007199254740993") }],
            },
          },
        }),
      );
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      expect(
        await within(rows()[0]!).findByRole("link", { name: "MetaMask" }),
      ).toHaveAttribute("href", `https://basescan.org/address/${VAULT}`);
      has(rows()[0], "· 200 USDC left");
      expect(screen.queryByText(/You’re signing for/)).toBeNull();
      const step = stepBody("eip155:8453", USDC_RULE, ADMIN.toLowerCase());
      expect(sentBodies()).toEqual([step, { ...step, signature }]);
    });

    it("warns that replacing a grant takes two signatures, signs each step handed back, and stays on the chain it is on", async () => {
      Object.assign(kit.identity, { address: ADMIN, chainId: 8453 });
      rules = withUsdc({
        enforcement: [
          grant({
            state: "behind",
            account: VAULT,
            signer: { family: "evm", address: ADMIN },
          }),
        ],
      });
      // The row stays ready for the second step after the first.
      answer(GRANT_STEP, typedAction, rules);
      const release = hold(kit.signTypedData);
      await renderPolicies();
      await sign();
      await see(/Replacing an earlier version takes two signatures/);
      await release({ signature });
      expect(
        writes().map((call) => (call.body as { signature?: string }).signature),
      ).toEqual([undefined, signature]);
      expect(button("Sign to deploy")).toBeEnabled();
      expect(screen.queryByText(/two signatures/)).toBeNull();
      expect(kit.switchChain).not.toHaveBeenCalled();
    });

    it("confirms straight away when the chain already shows the rule", async () => {
      kit.identity.svmAddress = OWNER;
      rules = withSol({ enforcement: [provider({ state: "behind" })] });
      answer(STEP, null, withSol());
      await renderPolicies();
      await sign();
      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      expect(kit.signTypedData).not.toHaveBeenCalled();
    });

    const otherDomain = { ...typedData.domain, chainId: 10 };
    it.each([
      [
        "a transaction for another network than the entry's",
        { ...transaction, network: "solana:devnet" },
        NETWORK_REFUSED,
      ],
      [
        "typed data for another network than the entry's",
        { ...typedAction, network: "eip155:10" },
        NETWORK_REFUSED,
      ],
      [
        "typed data whose domain names another chain",
        { ...typedAction, typed_data: { ...typedData, domain: otherDomain } },
        "The data to sign is for another chain than this policy's.",
      ],
      [
        "a kind of step it does not know",
        { kind: "user_op", network: "solana:mainnet-beta" },
        /unsupported action: user_op/,
      ],
    ])("refuses %s, and signs nothing", async (_what, action, message) => {
      if (action.network.startsWith("solana")) {
        kit.identity.svmAddress = OWNER;
        rules = withSol({ enforcement: [provider()] });
        answer(STEP, action, withSol());
      } else {
        kit.identity.address = ADMIN;
        rules = withUsdc({ enforcement: [grant()] });
        answer(GRANT_STEP, action, withUsdc());
      }
      await renderPolicies();
      await sign();
      await see(message);
      expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
      expect(kit.signTypedData).not.toHaveBeenCalled();
      expect(kit.switchChain).not.toHaveBeenCalled();
      // Only prepare was sent: nothing is confirmed.
      expect(writes()).toHaveLength(1);
    });

    it("says so when the owner declines, or the backend refuses the step, and reads the policies again", async () => {
      kit.identity.address = ADMIN;
      rules = withUsdc({ enforcement: [grant()] });
      answer(GRANT_STEP, typedAction, withUsdc());
      kit.signTypedData.mockRejectedValueOnce(declined());
      await renderPolicies();
      await sign();
      await see(DECLINED);
      expect(writes()).toHaveLength(1);
      const before = reads("/rules").length;
      refuseStep(GRANT_STEP);
      await sign();
      await see(NOT_ENFORCEABLE);
      expect(kit.signTypedData).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(reads("/rules").length).toBeGreaterThan(before),
      );
    });

    it("shows when the chain ends a rule only if that is over a day from the policy's end", async () => {
      const until = hours(24 * 20);
      const withEnd = (expires_at: number) =>
        allow([solRule({ active_until: until })], {
          enforcement: [provider({ state: "on", ready: false, expires_at })],
        });
      rules = withEnd(until + 6 * 3600);
      await renderPolicies();
      lacks(rows()[0], "chain ends");
      cleanup();
      rules = withEnd(until + 3 * 86_400);
      await renderPolicies();
      has(rows()[0], `· chain ends ${day(until + 3 * 86_400)}`);
    });

    describe("a policy removed while the chain still holds it", () => {
      const NOTE =
        "This rule was removed or has ended. Sign to take off what the chain holds for it.";
      /** What the backend keeps under the removed rule's id. */
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
      const without = (enforcement: object[], live: object[] = []) =>
        allow(live, { enforcement });
      const takeOff = () => click("Sign to take off", removedRows()[0]);
      const removeStep = (network: string, rule: string, owner: string) =>
        stepBody(network, rule, owner, { remove: true });

      it("lists it after the live policies as removed, with who holds it, what is left and why, and no remove or period", async () => {
        rules = without([kept()], [solRule()]);
        await renderPolicies();
        expect(rows()).toHaveLength(1);
        has(rows()[0], "Up to 0.5 SOL on Jupiter");
        const [row] = removedRows();
        expect(removedRows()).toHaveLength(1);
        has(
          row,
          "Removed · USDC on Uniswap",
          "Onchain Enforcement:MetaMask",
          "· 5 USDC left",
          NOTE,
        );
        lacks(row, "Active period", "Total not enforced", "Out of date");
        expect(within(row!).getByRole("img", { name: "Base" })).toBeTruthy();
        expect(
          within(row!).getByRole("link", { name: "MetaMask" }),
        ).toHaveAttribute("href", `https://basescan.org/address/${VAULT}`);
        expect(
          within(row!).queryByRole("button", { name: /Remove the policy/ }),
        ).toBeNull();
        expect(
          within(row!).getByRole("button", { name: "Sign to take off" }),
        ).toBeTruthy();
        noButton("Sign to deploy");
        after(rows()[0]!, row!);
      });

      it("is all a wallet with no live policy shows: names an unknown token and app raw, an address short, the wallet to connect, and an unread entry without a button", async () => {
        const asset =
          "eip155:8453/erc20:0xabcdef0000000000000000000000000000001234";
        rules = without([
          kept({ rule: `${asset}@protocol:zzzapp` }),
          kept({ rule: `${USDC}@address:${OTHER}` }),
          kept({ ready: false, state: "unverified", note: "Not readable." }),
        ]);
        const card = await renderPolicies();
        expect(rows()).toHaveLength(0);
        has(card, "No policies yet.");
        const [unknown, address, unread] = removedRows();
        // No decimals: the chain's number is shown as it is.
        has(
          unknown,
          "Removed · 0xabcd…1234 on Zzzapp",
          "· 5000000 0xabcd…1234 left",
          /Connect 0xAbCd…Ef12 to sign\./,
        );
        expect(
          within(unknown!).getByRole("button", { name: "Sign to take off" }),
        ).toBeDisabled();
        has(address, "Removed · USDC to 0x1111…2222");
        has(unread, "Not verified", "Not readable.");
        noButton("Sign to take off", unread);
      });

      it("ignores a provider that is off, and an entry for a policy that is still there", async () => {
        rules = without([
          kept({ state: "off", ready: false, left: null, note: "Declined." }),
          kept({ rule: `${USDC}@any`, state: "off", ready: true, left: null }),
        ]);
        const card = await renderPolicies();
        expect(removedRows()).toHaveLength(0);
        lacks(card, "Declined.");
        has(card, "No policies yet.");
        cleanup();
        // The rule is current: its own row offers the deployment.
        rules = withUsdc({ enforcement: [kept()] });
        await renderPolicies();
        expect(rows()).toHaveLength(1);
        expect(removedRows()).toHaveLength(0);
        expect(button("Sign to deploy")).toBeTruthy();
        noButton("Sign to take off");
      });

      it("takes a grant off with one revoking signature: prepare with remove, the wallet signs, confirm, and the row goes", async () => {
        Object.assign(kit.identity, { address: ADMIN, chainId: 8453 });
        rules = without([kept()], [solRule()]);
        answer(GRANT_STEP, typedAction, without([], [solRule()]));
        const release = hold(kit.signTypedData);
        await renderPolicies();
        await takeOff();
        // No second signature is promised although the entry is behind.
        await see(
          "You’re signing for: Take USDC on Uniswap (Base) off the chain. Check it in your wallet.",
        );
        expect(screen.queryByText(/two signatures/)).toBeNull();
        expect(button("Waiting for wallet…")).toBeDisabled();
        await release({ signature });
        expect(kit.signTypedData).toHaveBeenCalledTimes(1);
        expect(kit.signTypedData).toHaveBeenCalledWith(
          expect.objectContaining({
            signer: ADMIN,
            chainId: 8453,
            description: "Remove policy from chain",
          }),
        );
        expect(kit.signAndSendSolanaTransaction).not.toHaveBeenCalled();
        const step = removeStep("eip155:8453", USDC_RULE, ADMIN);
        expect(sentBodies()).toEqual([step, { ...step, signature }]);
        await waitFor(() => expect(removedRows()).toHaveLength(0));
        expect(rows()).toHaveLength(1);
        expect(screen.queryByText(/You’re signing for/)).toBeNull();
      });

      it("takes a Solana role off with one transaction: prepare with remove, the wallet sends it, confirm, and the row goes", async () => {
        kit.identity.svmAddress = OWNER;
        const keptSol = provider({
          state: "behind",
          ready: true,
          left: "2500000000",
          note: NOTE,
          account: OWNER,
          signer: { family: "svm", address: OWNER },
        });
        rules = without([keptSol], [usdcRule()]);
        answer(STEP, transaction, without([], [usdcRule()]));
        await renderPolicies();
        const [row] = removedRows();
        has(
          row,
          "Removed · SOL on Jupiter",
          "Onchain Enforcement:Vault",
          "· 2.5 SOL left",
        );
        expect(within(row!).getByRole("img", { name: "Solana" })).toBeTruthy();
        await takeOff();
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
        const step = removeStep("solana:mainnet-beta", SOL_RULE, OWNER);
        expect(sentBodies()).toEqual([step, step]);
        expect(rows()).toHaveLength(1);
      });

      it("keeps the row and says what went wrong when the owner declines, and when the step fails", async () => {
        kit.identity.address = ADMIN;
        rules = without([kept()]);
        answer(GRANT_STEP, typedAction, without([]));
        kit.signTypedData.mockRejectedValueOnce(declined());
        await renderPolicies();
        await takeOff();
        await see(DECLINED, removedRows()[0]);
        expect(writes()).toHaveLength(1);
        refuseStep(GRANT_STEP);
        await takeOff();
        await see(NOT_ENFORCEABLE, removedRows()[0]);
        expect(removedRows()).toHaveLength(1);
      });

      describe("the owner sends their own signed revocation", () => {
        const SENT_NOTE =
          "Your revocation is signed. Send it from your wallet to take the grant off chain.";
        const MANAGER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
        const sendAction = {
          kind: "evm_transaction",
          network: "eip155:8453",
          to: MANAGER,
          data: "0xcafe0001",
          value: "0x0",
        };
        const toSend = (extra: object = {}, live: object[] = []) =>
          without([kept({ note: SENT_NOTE, ...extra })], live);
        const sendTo = (action: object, confirmed = without([])) =>
          answer(GRANT_STEP, action, confirmed);
        const send = () => click("Send revocation", removedRows()[0]);

        it("labels the step Send revocation, and only the owning wallet may send it", async () => {
          kit.identity.address = OTHER;
          rules = toSend();
          await renderPolicies();
          const [row] = removedRows();
          has(row, SENT_NOTE, /Connect 0xAbCd…Ef12 to send\./);
          expect(
            within(row!).getByRole("button", { name: "Send revocation" }),
          ).toBeDisabled();
          noButton("Sign to take off", row);
        });

        it("sends it from the owner's wallet on the policy's chain, then confirms with no signature, and the row goes", async () => {
          kit.identity.address = ADMIN;
          rules = toSend({}, [solRule()]);
          sendTo(sendAction, without([], [solRule()]));
          const release = hold(kit.sendTransaction);
          await renderPolicies();
          await send();
          await see(
            "You’re sending: Take USDC on Uniswap (Base) off the chain. Your wallet pays the network fee.",
          );
          expect(button("Waiting for wallet…")).toBeDisabled();
          // Exactly the prepared transaction: no account abstraction, no value.
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
          await release({ txHash: "0xsent" });
          const step = removeStep("eip155:8453", USDC_RULE, ADMIN);
          expect(sentBodies()).toEqual([step, step]);
          await waitFor(() => expect(removedRows()).toHaveLength(0));
          expect(rows()).toHaveLength(1);
          expect(kit.signTypedData).not.toHaveBeenCalled();
          expect(screen.queryByText(/You’re sending/)).toBeNull();
        });

        it("confirms again until the backend's node shows the transaction, and says so when it never does", async () => {
          vi.useFakeTimers({ shouldAdvanceTime: true });
          try {
            Object.assign(kit.identity, { address: ADMIN, chainId: 8453 });
            const still = toSend();
            rules = still;
            let confirms = 0;
            respond = (method, path) => {
              if (method !== "POST") return undefined;
              if (path === `${GRANT_STEP}/prepare`)
                return Response.json({ action: sendAction });
              confirms += 1;
              return Response.json({
                rules: confirms < 3 ? still : without([kept({ state: "off", note: null })]),
              });
            };
            await renderPolicies();
            await send();
            await act(() => vi.advanceTimersByTimeAsync(5_000));
            await waitFor(() => expect(removedRows()).toHaveLength(0));
            expect(confirms).toBe(3);
            expect(kit.sendTransaction).toHaveBeenCalledTimes(1);
            // Already on the policy's chain: the wallet is not moved.
            expect(kit.switchChain).not.toHaveBeenCalled();
            cleanup();
            rules = still;
            sendTo(sendAction, still);
            await renderPolicies();
            await send();
            await act(() => vi.advanceTimersByTimeAsync(15_000));
            await see(
              /Your transaction was sent, but Aomi doesn’t see it on the chain yet/,
              removedRows()[0],
            );
            expect(removedRows()).toHaveLength(1);
          } finally {
            vi.useRealTimers();
          }
        });

        it("keeps the row and shows the wallet's error when the send fails, and when the owner declines", async () => {
          Object.assign(kit.identity, { address: ADMIN, chainId: 8453 });
          rules = toSend();
          sendTo(sendAction);
          kit.sendTransaction.mockRejectedValueOnce(
            new Error("wallet_sequential_transaction_reverted"),
          );
          await renderPolicies();
          await send();
          await see("wallet_sequential_transaction_reverted", removedRows()[0]);
          expect(writes()).toHaveLength(1);
          await waitFor(() => expect(reads("/rules")).toHaveLength(2));
          kit.sendTransaction.mockRejectedValueOnce(declined());
          await send();
          await see(DECLINED, removedRows()[0]);
          expect(writes()).toHaveLength(2);
          expect(removedRows()).toHaveLength(1);
        });

        // The client's own parse refuses most of these first; the widget is a second wall.
        it.each([
          [{ network: "eip155:10" }, NETWORK_REFUSED],
          [{ to: "vitalik.eth" }, /action.to must be a 20-byte/],
          [{ to: OTHER }, /different delegation manager/],
          [{ value: "0xde0b6b3a7640000" }, /Aomi asked to send funds/],
        ] as const)("refuses a send with %o", async (bad, message) => {
          kit.identity.address = ADMIN;
          rules = toSend();
          sendTo({ ...sendAction, ...bad });
          await renderPolicies();
          await send();
          await see(message);
          expect(kit.sendTransaction).not.toHaveBeenCalled();
          expect(kit.switchChain).not.toHaveBeenCalled();
          expect(writes()).toHaveLength(1);
        });

        it("refuses to send for a Solana signer, or from a wallet that cannot send", async () => {
          Object.assign(kit.identity, { address: ADMIN, svmAddress: OWNER });
          rules = toSend({ signer: { family: "svm", address: OWNER } });
          sendTo(sendAction);
          await renderPolicies();
          await send();
          await see("This wallet can't send that.");
          expect(kit.sendTransaction).not.toHaveBeenCalled();
          expect(writes()).toHaveLength(1);
          cleanup();
          kit.identity.svmAddress = undefined;
          rules = toSend();
          const original = kit.sendTransaction;
          (kit as { sendTransaction?: unknown }).sendTransaction = undefined;
          try {
            await renderPolicies();
            await send();
            await see("This wallet can't send that.");
            expect(writes()).toHaveLength(2);
          } finally {
            kit.sendTransaction = original;
          }
        });
      });
    });
  });

  describe("a waiting change", () => {
    const approveCall = (body: object = {}) => ({
      method: "POST",
      path: "/v1/account/rule-changes/ch-1/approve",
      body,
    });
    const adminChange = (sign_message: string, extra: object = {}) =>
      body({
        admin: { kind: "wallet", family: "evm", address: ADMIN },
        pending: change({
          signer: { kind: "wallet", family: "evm", address: ADMIN },
          sign_message,
        }),
        ...extra,
      });

    it("shows every wallet's change at the top, and Later leaves one line with Review or Decline", async () => {
      rules = body({
        pending: change({ proposed_by: "agent:telegram:7712345678" }),
      });
      await renderPolicies();
      const card = await changeCard();
      has(card, "expires in 23 h");
      fireEvent.click(within(card).getByRole("button", { name: "Later" }));
      const line = document.querySelector<HTMLElement>(
        "[data-pending-change]",
      )!;
      has(
        line,
        "Trading wallet · Aomi asks: USDC on Base: 200 → 400",
        "23 h left",
      );
      expect(document.querySelector("[data-rule-change]")).toBeNull();
      fireEvent.click(within(line).getByRole("button", { name: "Review" }));
      fireEvent.click(
        within(await changeCard()).getByRole("button", { name: "Later" }),
      );
      onPost(() => Response.json((rules = body())));
      fireEvent.click(button("Decline"));
      await see("Declined.");
      expect(writes()).toEqual([
        {
          method: "POST",
          path: "/v1/account/rule-changes/ch-1/decline",
          body: {},
        },
      ]);
      expect(document.querySelector("[data-pending-change]")).toBeNull();
    });

    it("approves with the session and shows the policies after it", async () => {
      rules = body({ pending: change() });
      await renderPolicies();
      const raised = usdcRule({ amount: "400000000" });
      onPost(() =>
        Response.json(
          (rules = body({
            revision: 4,
            rules: { mode: "blacklist", rules: [raised], linked_only: false },
          })),
        ),
      );
      await click("Approve", await changeCard());
      await see("Approved.");
      has(rows()[0], "Up to 400 USDC on Uniswap");
      expect(writes()).toEqual([approveCall()]);
      expect(document.querySelector("[data-rule-change]")).toBeNull();
    });

    it("stops offering a decision the moment the change expires", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const soon = Math.floor(Date.now() / 1000) + 20;
        rules = body({ pending: change({ expires_at: soon }) });
        await renderPolicies();
        const card = await changeCard();
        const decide = (name: string) =>
          within(card).getByRole("button", { name });
        expect(decide("Approve")).toBeEnabled();
        await act(() => vi.advanceTimersByTimeAsync(21_000));
        expect(within(card).getByText("expired")).toBeTruthy();
        expect(decide("Approve")).toBeDisabled();
        expect(decide("Decline")).toBeDisabled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("asks the admin wallet to sign the exact message and sends its signature", async () => {
      const message = "Aomi rule change ch-1\nUSDC on Base: 200 → 400";
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
      rules = adminChange(message);
      await renderPolicies();
      has(
        await changeCard(),
        "Only Ledger (0xAbCd…Ef12) can approve this. Aomi can't.",
      );
      noButton("Approve");
      onPost(() => Response.json((rules = body({ admin: rules.admin }))));
      fireEvent.click(button("Sign in wallet"));
      await see("Approved.");
      expect(kit.signMessage).toHaveBeenCalledWith({ non_typed_data: message });
      expect(writes()).toEqual([approveCall({ signature: "0xsigned" })]);
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
      fireEvent.click(button("Sign in wallet"));
      await waitFor(() => expect(writes()).toHaveLength(1));
      const [sent] = kit.signSolanaMessage.mock.calls[0] as unknown as [
        { message: string; signer: string },
      ];
      expect(sent.signer).toBe(mint);
      const bytes = Uint8Array.from(atob(sent.message), (c) => c.charCodeAt(0));
      expect(new TextDecoder().decode(bytes)).toBe("limit → 400");
      expect(writes()[0]!.body).toEqual({ signature: "c2lnbmVk" });
    });

    it("names the wallet that must sign when another one is connected", async () => {
      kit.identity.address = "0x9999000000000000000000000000000000001111";
      rules = adminChange("m", { admin: { kind: "aomi_managed" } });
      await renderPolicies();
      await see("Connect 0xAbCd…Ef12 to sign. 0x9999…1111 is connected now.");
      expect(button("Sign in wallet")).toBeDisabled();
      expect(kit.signMessage).not.toHaveBeenCalled();
    });

    it("says the wallet signed when sending the signature fails, and nothing signed when the prompt is closed", async () => {
      kit.identity.address = ADMIN;
      rules = adminChange("Aomi rule change ch-1");
      await renderPolicies();
      onPost(() => {
        throw new TypeError("network down");
      });
      fireEvent.click(button("Sign in wallet"));
      await see(
        "Your wallet signed, but the change couldn’t be sent. Check the policies before trying again.",
      );
      expect(screen.queryByText("Nothing was signed. Try again.")).toBeNull();
      kit.signMessage.mockRejectedValueOnce(new Error("User rejected"));
      fireEvent.click(button("Sign in wallet"));
      await see("Nothing was signed. Try again.");
    });

    it("asks an old sign-in to sign in again, and rereads when the change was already decided", async () => {
      rules = body({ pending: change() });
      await renderPolicies();
      onPost(() => refused("login_stale", 403));
      fireEvent.click(button("Approve"));
      await see("For a policy change, sign in again.");
      fireEvent.click(button("Sign in again"));
      await waitFor(() => expect(kit.signOutAccount).toHaveBeenCalledTimes(1));
      expect(document.querySelector("[data-rule-change]")).toBeTruthy();
      const before = reads("/rules").length;
      onPost(() => {
        rules = body();
        return refused("rules_change_not_open", 409);
      });
      fireEvent.click(button("Approve"));
      await see("That change was already decided.");
      expect(document.querySelector("[data-rule-change]")).toBeNull();
      expect(reads("/rules")).toHaveLength(before + 1);
    });
  });
});

describe("Settings › Policies › vault", () => {
  const vaultEntry = (extra: object = {}) =>
    grant({
      state: "on",
      ready: false,
      left: "200000000",
      account: VAULT,
      signer: { family: "evm", address: ADMIN },
      ...extra,
    });
  const vaults = () =>
    [...document.querySelectorAll("[data-vault]")] as HTMLElement[];
  const renderVault = async (enforcement = [vaultEntry()]) => {
    rules = body({ enforcement });
    const card = await renderPolicies();
    const [row] = vaults();
    await within(row!).findByText("USDC 95.00 · ETH 0.98");
    return { card, row: row! };
  };

  it("withdraws: the owner's wallet goes to the vault's chain, signs, then sends to the DelegationManager, and nothing goes to Aomi", async () => {
    kit.identity.address = ADMIN.toLowerCase();
    // r, s and v of a signature the vault could use.
    const usable = `0x${"11".repeat(32)}${"11".repeat(32)}1b`;
    kit.signTypedData.mockImplementationOnce(async () => ({
      signature: usable,
    }));
    const { row } = await renderVault();
    fireEvent.click(within(row).getByRole("button", { name: "Withdraw" }));
    fireEvent.change(within(row).getByRole("textbox", { name: "Amount" }), {
      target: { value: "12.5" },
    });
    const before = calls.length;
    chain.balances.mockImplementation(holdings(82_500_000));
    await click("Sign and send", row);
    await see("Withdrawn.", row);
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
    await within(row).findByText("USDC 82.50 · ETH 0.98");
    expect(calls.slice(before).filter((call) => call.method !== "GET")).toEqual(
      [],
    );
  });

  it("disables Withdraw, naming the owner's wallet, when another wallet is connected", async () => {
    kit.identity.address = OTHER;
    const { row } = await renderVault();
    expect(
      within(row).getByRole("button", { name: "Withdraw" }),
    ).toBeDisabled();
    has(row, "Connect 0xabcd…ef12 to sign.");
    expect(kit.signTypedData).not.toHaveBeenCalled();
  });
});
