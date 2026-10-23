import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AomiCreditApiError } from "@aomi-labs/client";

const mocks = vi.hoisted(() => ({
  connected: true,
  accountCredits: {
    get: vi.fn(),
    topUp: vi.fn(),
    methods: vi.fn(),
    purchase: vi.fn(),
    beginPurchase: vi.fn(),
  },
}));
const runtime = vi.hoisted(() => ({
  account: { credits: mocks.accountCredits },
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useAomiRuntime: () => runtime,
  useOptionalAomiRuntime: () => runtime,
}));

// Credits are read through the shell transport's client.
vi.mock("@/account/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/account/transport")>();
  const transport = actual.createShellTransport();
  return {
    ...actual,
    useShellTransport: () => ({ ...transport, client: runtime }),
  };
});

vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({
    identity: {
      isConnected: mocks.connected,
      address: "0x0000000000000000000000000000000000000001",
      chainId: 84532,
    },
    accountUser: { id: "user-1" },
    signTypedData: vi.fn(),
    switchChain: vi.fn(),
  }),
}));

vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({ readContract: async () => BigInt(50_000_000) }),
}));

import { CreditBank } from "@/account/usage/credit-bank/credit-bank";

function position(
  entries: Array<{
    id: number;
    amount_microusd: number;
    entry_kind: string;
    payment_method?: string | null;
    payment_provider?: string | null;
    external_payment_reference?: string | null;
    application_id?: number | null;
    metadata?: Record<string, unknown>;
    created_at: number;
  }> = [],
) {
  return {
    period_utc_month: "2026-09-01",
    included: {
      limit_microusd: 50_000_000,
      used_microusd: 12_500_000,
      remaining_microusd: 37_500_000,
    },
    bank: {
      balance_microusd: -250_000,
      outstanding_debt_microusd: 250_000,
    },
    entries,
    next_before_id: null,
  };
}

describe("Credit Bank", () => {
  beforeEach(() => {
    mocks.connected = true;
    window.localStorage.clear();
    mocks.accountCredits.get.mockReset();
    mocks.accountCredits.topUp.mockReset();
    mocks.accountCredits.beginPurchase.mockReset();
    mocks.accountCredits.methods.mockResolvedValue({ card: null, wallet: { min_microusd: 1000000, max_microusd: 1000000000, networks: [{ network: "eip155:84532", name: "Base Sepolia", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", recipient: "0x0000000000000000000000000000000000000002", confirmations: 2 }] } });
    mocks.accountCredits.purchase.mockRejectedValue(new AomiCreditApiError(404,"check payment"));
    mocks.accountCredits.get.mockImplementation(async () => {
      const response = await fetch(`/v1/account/credits?limit=25`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the requested top-up without initiating payment and requires a wallet", async () => {
    mocks.connected = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    render(<CreditBank initialTopUp />);
    expect(screen.getByRole("dialog", { name: "Add credits" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeEnabled();
    expect(mocks.accountCredits.topUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close top-up" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("uses the aligned disclosure and activity presentation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          position([
            {
              id: 9,
              amount_microusd: 5_000_000,
              entry_kind: "purchase",
              payment_method: "x402",
              payment_provider: "coinbase",
              external_payment_reference: `0x${"1".repeat(64)}`,
              metadata: { payment_network: "eip155:84532" },
              created_at: 1,
            },
            {
              id: 8,
              amount_microusd: -100_000,
              entry_kind: "usage_debit",
              application_id: 4,
              created_at: 1,
            },
          ]),
        ),
      ),
    );

    render(<CreditBank />);

    expect(await screen.findByText("-25 credits")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Credit bank/ }));
    expect(screen.getByText("Keep usage moving")).toBeTruthy();
    expect(screen.getByText("Wallet top-up")).toBeTruthy();
    expect(screen.getByText(/Coinbase x402/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View receipt" })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/0x${"1".repeat(64)}`,
    );
    expect(screen.getByText("Personal usage")).toBeTruthy();
    expect(screen.getByText("+500 credits")).toBeTruthy();
    expect(screen.getByText("−10 credits")).toBeTruthy();
    expect(screen.getByText(/Application 4/)).toBeTruthy();
  });

  it("shows empty and failed loading states inside the disclosure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(position()))
      .mockResolvedValueOnce(
        new Response("account unavailable", { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<CreditBank />);
    await screen.findByText("-25 credits");
    fireEvent.click(screen.getByRole("button", { name: /Credit bank/ }));
    expect(screen.getByText("No purchased-credit activity yet.")).toBeTruthy();

    view.unmount();
    render(<CreditBank />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Credit bank/ }));
    expect(await screen.findByText(/account unavailable/)).toBeTruthy();
  });

  it("validates whole credits and submits the reviewed wallet terms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(position())));
    mocks.accountCredits.beginPurchase.mockResolvedValue({ purchase: { id: "purchase-1", idempotency_key: "key-1", amount_microusd: 1_000_000, method: "wallet", status: "credited", terms: { network: "eip155:84532" } }, action: { kind: "done" } });
    render(<CreditBank initialTopUp />);
    await screen.findByRole("button", { name: "Pay 10.00 USDC" });
    const input=screen.getByLabelText("Top-up credits");
    fireEvent.change(input,{target:{value:"100.5"}});
    expect(screen.getByText("Choose 100–100,000 whole credits.")).toBeTruthy();
    expect(mocks.accountCredits.beginPurchase).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:"100"}});
    const pay=screen.getByRole("button",{name:"Pay 1.00 USDC"});
    await waitFor(()=>expect(pay).toBeEnabled());
    fireEvent.click(pay);
    await waitFor(()=>expect(mocks.accountCredits.beginPurchase).toHaveBeenCalledWith({amountMicrousd:1_000_000,method:"wallet",chain:"eip155:84532",idempotencyKey:expect.any(String),x402:expect.any(Object)}));
    expect(await screen.findByText("100 credits added. Your balance is up to date.")).toBeTruthy();
  });

  it("resumes a server-owned pending purchase without signing again", async () => {
    mocks.connected=false;
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json(position())));
    mocks.accountCredits.purchase.mockResolvedValue({purchase:{id:"pending",idempotency_key:"original",amount_microusd:10_000_000,method:"wallet",status:"processing",terms:{network:"eip155:84532"}},action:{kind:"wait"}});
    render(<CreditBank initialTopUp />);
    expect(await screen.findByText(/Confirming your payment/)).toBeTruthy();
    expect(screen.getByLabelText("Top-up credits")).toBeDisabled();
    expect(mocks.accountCredits.beginPurchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Close top-up"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  });
});
