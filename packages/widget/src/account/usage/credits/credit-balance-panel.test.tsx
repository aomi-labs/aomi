import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AomiCreditApiError } from "@aomi-labs/client";

const mocks = vi.hoisted(() => ({
  connected: true,
  accountCredits: {
    get: vi.fn(),
    ledger: vi.fn(),
    methods: vi.fn(),
    fundingEvent: vi.fn(),
    beginFunding: vi.fn(),
    cancelFunding: vi.fn(),
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

vi.mock("./card-form", () => ({ default: () => <div>Secure card form</div> }));

import { CreditBalancePanel } from "@/account/usage/credits/credit-balance-panel";

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
    balance_microusd: -250_000,
    reserved_microusd: 0,
    available_microusd: -250_000,
    debt_microusd: 250_000,
    entries,
    next_before_id: null,
  };
}

describe("Credit balance", () => {
  beforeEach(() => {
    mocks.connected = true;
    window.localStorage.clear();
    mocks.accountCredits.get.mockReset();
    mocks.accountCredits.beginFunding.mockReset();
    mocks.accountCredits.methods.mockResolvedValue({
      card: null,
      wallet: {
        min_microusd: 1000000,
        max_microusd: 1000000000,
        networks: [
          {
            network: "eip155:84532",
            name: "Base Sepolia",
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            recipient: "0x0000000000000000000000000000000000000002",
            confirmations: 2,
          },
        ],
      },
    });
    mocks.accountCredits.fundingEvent.mockRejectedValue(
      new AomiCreditApiError(404, "check payment"),
    );
    mocks.accountCredits.ledger.mockImplementation(async () => {
      const response = await fetch(`/v1/account/credits/ledger?limit=25`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    });
    mocks.accountCredits.get.mockImplementation(async () => {
      const response = await fetch(`/v1/account/credits`);
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
    render(<CreditBalancePanel initialTopUp />);
    expect(screen.getByRole("dialog", { name: "Add credits" })).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Connect wallet" }),
    ).toBeEnabled();
    expect(mocks.accountCredits.beginFunding).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close checkout" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("puts USDC first and navigates to a separate card panel without starting payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    const available = await mocks.accountCredits.methods();
    mocks.accountCredits.methods.mockResolvedValue({
      ...available,
      card: { public_key: "pk_test_example" },
    });
    render(<CreditBalancePanel initialTopUp />);
    const card = await screen.findByRole("button", {
      name: "Card Card · Apple Pay · Link",
    });
    await waitFor(() => expect(card).toBeEnabled());
    const group = screen.getByRole("group", { name: "Payment method" });
    expect(group.querySelector("button")?.textContent).toContain("USDC");
    expect(screen.queryByText("Secure card form")).toBeNull();
    fireEvent.click(card);
    expect(await screen.findByText("Secure card form")).toBeVisible();
    expect(
      screen.queryByRole("spinbutton", { name: "Top-up credits" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to amount and payment method" }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "Top-up credits" }),
    ).toHaveValue(1000);
    expect(screen.queryByText("Secure card form")).toBeNull();
    expect(mocks.accountCredits.beginFunding).not.toHaveBeenCalled();
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
              payment_method: "wallet",
              payment_provider: "x402",
              external_payment_reference: `test:eip155:84532:0x${"1".repeat(64)}`,
              metadata: {
                payment_network: "eip155:84532",
                transaction: `0x${"1".repeat(64)}`,
              },
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

    render(<CreditBalancePanel />);

    expect(await screen.findByText("-25 credits")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Credit balance/ }));
    expect(screen.getByText("Keep usage moving")).toBeTruthy();
    expect(await screen.findByText("Credits added")).toBeTruthy();
    expect(screen.getByText(/USDC payment/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View receipt" })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/0x${"1".repeat(64)}`,
    );
    expect(screen.getByText("Personal usage")).toBeTruthy();
    expect(screen.getByText("+500 credits")).toBeTruthy();
    expect(screen.getByText("−10 credits")).toBeTruthy();
    expect(screen.getByText(/Application 4/)).toBeTruthy();
  });

  it("renders card funding as USD without a wallet receipt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          position([
            {
              id: 20,
              amount_microusd: 5_000_000,
              entry_kind: "purchase",
              payment_method: "card",
              payment_provider: "stripe",
              external_payment_reference: "test:pi_test",
              created_at: 1,
            },
          ]),
        ),
      ),
    );
    render(<CreditBalancePanel />);
    await screen.findByText("-25 credits");
    fireEvent.click(screen.getByRole("button", { name: /Credit balance/ }));
    expect(await screen.findByText(/Card payment/)).toBeTruthy();
    expect(screen.getByText("$5.00 paid")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View receipt" })).toBeNull();
    expect(screen.queryByText(/Wallet top-up|USDC payment/)).toBeNull();
  });

  it("clears a failed balance read after retry", async () => {
    mocks.accountCredits.get
      .mockRejectedValueOnce(new Error("Balance unavailable"))
      .mockResolvedValue(position());
    mocks.accountCredits.ledger.mockResolvedValue({
      entries: [],
      next_before_id: null,
    });
    render(<CreditBalancePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Credit balance/ }));
    await screen.findByText(/Balance unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("-25 credits");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows empty and failed loading states inside the disclosure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(position()))
      .mockResolvedValueOnce(Response.json(position()))
      .mockResolvedValueOnce(
        new Response("account unavailable", { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<CreditBalancePanel />);
    await screen.findByText("-25 credits");
    fireEvent.click(screen.getByRole("button", { name: /Credit balance/ }));
    expect(
      await screen.findByText("No purchased-credit activity yet."),
    ).toBeTruthy();

    view.unmount();
    render(<CreditBalancePanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Credit balance/ }));
    expect(await screen.findByText(/account unavailable/)).toBeTruthy();
  });

  it("validates whole credits and submits the reviewed wallet terms", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    mocks.accountCredits.beginFunding.mockResolvedValue({
      funding_event: {
        id: "purchase-1",
        idempotency_key: "key-1",
        amount_microusd: 1_000_000,
        method: "wallet",
        status: "credited",
        terms: { network: "eip155:84532" },
      },
      action: { kind: "done" },
    });
    render(<CreditBalancePanel initialTopUp />);
    await screen.findByRole("button", { name: "Pay 10.00 USDC" });
    const input = screen.getByLabelText("Top-up credits");
    fireEvent.change(input, { target: { value: "100.5" } });
    expect(screen.getByText("Choose 100–100,000 whole credits.")).toBeTruthy();
    expect(mocks.accountCredits.beginFunding).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "100" } });
    const pay = screen.getByRole("button", { name: "Pay 1.00 USDC" });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(pay);
    await waitFor(() =>
      expect(mocks.accountCredits.beginFunding).toHaveBeenCalledWith({
        amountMicrousd: 1_000_000,
        method: "wallet",
        chain: "eip155:84532",
        idempotencyKey: expect.any(String),
        x402: expect.any(Object),
      }),
    );
    expect(
      await screen.findByText("100 credits added. Your balance is up to date."),
    ).toBeTruthy();
  });

  it("resumes a server-owned pending purchase without signing again", async () => {
    mocks.connected = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    mocks.accountCredits.fundingEvent.mockResolvedValue({
      funding_event: {
        id: "pending",
        idempotency_key: "original",
        amount_microusd: 10_000_000,
        method: "wallet",
        status: "processing",
        terms: { network: "eip155:84532" },
      },
      action: { kind: "wait" },
    });
    render(<CreditBalancePanel initialTopUp />);
    expect(await screen.findByText(/Confirming your payment/)).toBeTruthy();
    expect(screen.getByLabelText("Top-up credits")).toBeDisabled();
    expect(mocks.accountCredits.beginFunding).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close checkout" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows durable processing after a lost settlement response, not a failed payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    mocks.accountCredits.beginFunding.mockImplementation(async () => {
      mocks.accountCredits.fundingEvent.mockResolvedValue({
        funding_event: {
          id: "recovering",
          idempotency_key: "original",
          amount_microusd: 10_000_000,
          method: "wallet",
          status: "processing",
          terms: { network: "eip155:84532" },
        },
        action: { kind: "wait" },
      });
      throw new AomiCreditApiError(503, "start payment");
    });
    render(<CreditBalancePanel initialTopUp />);
    const pay = await screen.findByRole("button", { name: "Pay 10.00 USDC" });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(pay);
    expect(await screen.findByText(/Confirming your payment/)).toBeTruthy();
    expect(screen.queryByText(/Failed to start payment/)).toBeNull();
    expect(mocks.accountCredits.beginFunding).toHaveBeenCalledTimes(1);
  });

  it("lets an unsigned wallet purchase be abandoned for a new amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    const pending = {
      id: "challenged",
      idempotency_key: "original",
      amount_microusd: 10_000_000,
      method: "wallet",
      status: "awaiting_action",
      terms: { network: "eip155:84532" },
    };
    mocks.accountCredits.fundingEvent.mockResolvedValue({
      funding_event: pending,
      action: { kind: "wait" },
    });
    mocks.accountCredits.cancelFunding.mockResolvedValue({
      funding_event: { ...pending, status: "canceled" },
      action: { kind: "wait" },
    });
    render(<CreditBalancePanel initialTopUp />);
    // The amount is pinned to the open purchase until it is settled or abandoned.
    expect(await screen.findByLabelText("Top-up credits")).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel this payment" }),
    );
    await waitFor(() =>
      expect(mocks.accountCredits.cancelFunding).toHaveBeenCalledWith(
        "challenged",
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Choose a new payment" }),
    );
    expect(screen.getByLabelText("Top-up credits")).toBeEnabled();
    expect(mocks.accountCredits.beginFunding).not.toHaveBeenCalled();
  });
});
