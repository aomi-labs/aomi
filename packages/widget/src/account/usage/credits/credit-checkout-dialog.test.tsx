import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AomiCreditApiError } from "@aomi-labs/client";

const modules = vi.hoisted(() => ({
  credits: {
    methods: vi.fn(),
    fundingEvent: vi.fn(),
    beginFunding: vi.fn(),
    cancelFunding: vi.fn(),
  },
}));

vi.mock("@/account/transport", () => ({
  useShellTransport: () => ({
    aomi: { account: { credits: modules.credits } },
  }),
}));
vi.mock("@/account/use-account-credits", () => ({
  useAccountCredits: () => ({ data: undefined }),
}));
vi.mock("@/ui/widget-scope", () => ({ useWidgetOverlay: () => null }));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({
    identity: { address: undefined, isConnected: false, chainId: undefined },
    signTypedData: undefined,
    connect: vi.fn(),
    switchChain: vi.fn(),
    wallets: [],
  }),
}));

import { CreditCheckoutDialog } from "./credit-checkout-dialog";

describe("credit checkout test funding", () => {
  afterEach(() => vi.clearAllMocks());

  it("clearly warns about Production credits and offers sandbox Stripe and Sepolia", async () => {
    modules.credits.methods.mockResolvedValue({
      card: {
        public_key: "pk_live_fixture",
        environment: "production",
        min_microusd: 5_000_000,
        max_microusd: 1_000_000_000,
      },
      test_card: {
        public_key: "pk_test_fixture",
        environment: "test",
        min_microusd: 5_000_000,
        max_microusd: 1_000_000_000,
      },
      wallet: {
        min_microusd: 1_000_000,
        max_microusd: 1_000_000_000,
        networks: [
          {
            network: "eip155:84532",
            name: "Base Sepolia",
            asset: "0x0000000000000000000000000000000000000001",
            recipient: "0x0000000000000000000000000000000000000002",
            confirmations: 2,
          },
        ],
      },
    });
    modules.credits.fundingEvent.mockRejectedValue(
      new AomiCreditApiError(404, "load payment"),
    );

    await act(async () => {
      render(
        <CreditCheckoutDialog
          open
          onClose={vi.fn()}
          onSuccess={vi.fn(async () => undefined)}
          credits={modules.credits as never}
        />,
      );
    });

    expect(
      await screen.findByText(
        /On Production, those credits can be spent on live Aomi services/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("button", { name: /Stripe sandbox/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Base Sepolia/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Card or wallet pay/ }),
    ).toBeTruthy();
  });
});
