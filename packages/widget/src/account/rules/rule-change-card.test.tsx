import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuleChangePanel } from "./rule-change-card";

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
}));
vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => kit }));

const WALLET = { id: "g-trading", name: "Trading wallet" };
const change = (extra: object = {}) => ({
  id: "ch-1",
  agent_wallet_id: WALLET.id,
  wallet_name: WALLET.name,
  lines: [{ text: "USDC on Base: 200 → 400", loosens: true }],
  state: "awaiting_admin",
  proposed_by: "portal",
  expires_at: Math.floor(Date.now() / 1000) + 23 * 3600 + 600,
  signer: null,
  sign_message: null,
  ...extra,
});
const rules = {
  agent_wallet_id: WALLET.id,
  wallet_name: WALLET.name,
  revision: 4,
  rules: { mode: "blacklist", rules: [], linked_only: false },
  sentences: [],
  admin: { kind: "aomi_managed" },
  stopped_until: null,
  pending: null,
  enforced_by: {},
  enforcement: [],
  admin_wallets: [],
};

let held: ReturnType<typeof change>;
let respond: (method: string, path: string) => Response | undefined;
beforeEach(() => {
  held = change();
  respond = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://portal.test");
      return (
        respond(init?.method ?? "GET", url.pathname) ?? Response.json(held)
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RuleChangePanel", () => {
  const client = async () =>
    (await import("@/account/transport")).createShellTransport().aomi;
  const show = async () =>
    render(
      <RuleChangePanel
        client={await client()}
        changeId="ch-1"
        onClose={vi.fn()}
      />,
    );

  it("renders the waiting change's card as a policy change, and its outcome once approved", async () => {
    await show();
    const card = await screen.findByRole("region", {
      name: "Policy change for Trading wallet",
    });
    expect(card).toHaveTextContent("Policy change · Trading wallet");
    expect(screen.getByText("Review policy change")).toBeTruthy();
    expect(screen.queryByText(/rule change/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    respond = (method) =>
      method === "POST" ? Response.json(rules) : undefined;
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("USDC on Base: 200 → 400")).toBeTruthy();
  });

  it.each([
    ["applied", "Approved"],
    ["declined", "Declined"],
    ["expired", "Expired"],
    ["superseded", "Replaced by a newer change"],
  ])("shows a %s change as %s", async (state, title) => {
    held = change({ state });
    await show();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("says when the change does not exist", async () => {
    respond = () =>
      Response.json({ error: "rules_change_not_found" }, { status: 404 });
    await show();
    expect(await screen.findByText("This change doesn’t exist")).toBeTruthy();
  });
});
