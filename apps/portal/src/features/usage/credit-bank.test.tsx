import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AomiCreditApiError } from "@aomi-labs/client";

const mocks = vi.hoisted(() => ({
  connected: true,
  accountCredits: {
    get: vi.fn(),
    topUp: vi.fn(),
  },
}));

vi.mock("@aomi-labs/react", () => ({
  useAomiRuntime: () => ({ account: { credits: mocks.accountCredits } }),
}));

vi.mock("@aomi-labs/widget-lib", () => ({
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

import { CreditBank } from "./credit-bank";

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
    mocks.accountCredits.get.mockImplementation(async () => {
      const response = await fetch(`/v1/account/credits?limit=25`);
      return response.json();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(screen.getByText("Unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Credit bank/ }));
    expect(await screen.findByText(/account unavailable/)).toBeTruthy();
  });

  it("reviews and submits a one-credit wallet top-up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    mocks.accountCredits.topUp.mockResolvedValue({
      ...position(),
      bank: { balance_microusd: 10_000, outstanding_debt_microusd: 0 },
    });
    render(<CreditBank />);
    await screen.findByText("-25 credits");

    fireEvent.click(screen.getByRole("button", { name: /Credit bank/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    expect(screen.getByText("100 credits = 1.00 USDC")).toBeTruthy();

    const input = screen.getByLabelText("Top-up credits");
    fireEvent.change(input, { target: { value: "0" } });
    expect(
      screen.getByText("Choose between 1 and 100,000 credits."),
    ).toBeTruthy();
    expect(mocks.accountCredits.topUp).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay 0.01 USDC" }));
    await waitFor(() =>
      expect(mocks.accountCredits.topUp).toHaveBeenCalledOnce(),
    );
    expect(mocks.accountCredits.topUp).toHaveBeenCalledWith({
      amountMicrousd: 10_000,
      idempotencyKey: expect.any(String),
      recover: false,
    });
    expect(
      await screen.findByText("1 credit added. Your bank now has 1 credit."),
    ).toBeTruthy();
  });

  it("recovers a pending top-up without reconnecting the wallet", async () => {
    mocks.connected = false;
    window.localStorage.setItem(
      "aomi_credit_topup:user-1",
      JSON.stringify({
        idempotencyKey: "topup-recovery",
        amountMicrousd: 250_000,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    mocks.accountCredits.topUp.mockResolvedValue({
      ...position(),
      bank: { balance_microusd: 10_000, outstanding_debt_microusd: 0 },
    });

    render(<CreditBank />);
    await screen.findByText("-25 credits");
    fireEvent.click(screen.getByRole("button", { name: /Credit bank/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    expect(screen.getByLabelText("Top-up credits")).toHaveValue(25);
    expect(screen.getByLabelText("Top-up credits")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Pay 0.25 USDC" }));

    await waitFor(() =>
      expect(mocks.accountCredits.topUp).toHaveBeenCalledOnce(),
    );
    expect(mocks.accountCredits.topUp).toHaveBeenCalledWith({
      amountMicrousd: 250_000,
      idempotencyKey: "topup-recovery",
      recover: true,
    });
  });

  it("keeps an uncertain payment pending instead of asking for a new payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position())),
    );
    mocks.accountCredits.topUp.mockRejectedValue(
      new AomiCreditApiError(502, "top up account credits"),
    );

    render(<CreditBank />);
    await screen.findByText("-25 credits");
    fireEvent.click(screen.getByRole("button", { name: /Credit bank/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay 10.00 USDC" }));

    expect(
      await screen.findByText("Failed to top up account credits: HTTP 502"),
    ).toBeTruthy();
    expect(screen.getByText("Confirming previous payment")).toBeTruthy();
    expect(window.localStorage.getItem("aomi_credit_topup:user-1")).toContain(
      "idempotencyKey",
    );
    expect(screen.queryByText(/Confirm the top-up again/)).toBeNull();
  });
});
