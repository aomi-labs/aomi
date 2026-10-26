import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AomiCreditApiError,
  AomiOAuthError,
  type AccountCreditsTransport,
} from "@aomi-labs/client";

vi.mock("@/account/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/account/transport")>()),
  useShellTransport: () => ({ client: { account: { credits: null } } }),
}));
vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => ({}) }));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({ readContract: async () => BigInt(50_000_000) }),
}));
vi.mock("./card-form", () => ({ default: () => <div>Secure card form</div> }));

import { CreditCheckoutDialog } from "./credit-checkout-dialog";

const credits = {
  methods: vi.fn(),
  fundingEvent: vi.fn(),
  beginFunding: vi.fn(),
  cancelFunding: vi.fn(),
};
const wallet = {
  identity: {
    isConnected: true,
    address: "0x0000000000000000000000000000000000000001",
    chainId: 84532,
  },
  signTypedData: vi.fn(),
  switchChain: vi.fn(),
  connect: vi.fn(),
} as never;
const expired = () =>
  new AomiOAuthError(
    "reauthorization_required",
    "Sign in to Aomi again before continuing.",
  );

function checkout(reconnect?: () => Promise<void>) {
  return render(
    <CreditCheckoutDialog
      open
      credits={credits as unknown as AccountCreditsTransport}
      wallet={wallet}
      reconnect={reconnect}
      onClose={() => {}}
      onSuccess={async () => {}}
    />,
  );
}

async function payFiveDollars() {
  fireEvent.change(await screen.findByLabelText("Top-up credits"), {
    target: { value: "500" },
  });
  const pay = await screen.findByRole("button", { name: "Pay 5.00 USDC" });
  await waitFor(() => expect(pay).toBeEnabled());
  fireEvent.click(pay);
}

describe("Credit checkout authorization recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credits.methods.mockResolvedValue({
      card: null,
      wallet: {
        min_microusd: 1_000_000,
        max_microusd: 1_000_000_000,
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
    credits.fundingEvent.mockRejectedValue(
      new AomiCreditApiError(404, "check payment"),
    );
  });

  it("offers reconnect, blocks payment, and resumes with the same amount and key", async () => {
    credits.beginFunding.mockRejectedValueOnce(expired()).mockResolvedValue({
      funding_event: {
        id: "purchase-1",
        idempotency_key: "kept",
        amount_microusd: 5_000_000,
        method: "wallet",
        status: "credited",
        terms: { network: "eip155:84532" },
      },
      action: { kind: "done" },
    });
    const reconnect = vi.fn(async () => {});
    checkout(reconnect);
    await payFiveDollars();
    const button = await screen.findByRole("button", {
      name: "Reconnect Aomi",
    });
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
    expect(screen.getByLabelText("Top-up credits")).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
    // Recovery re-reads what Payment already holds before paying again.
    await waitFor(() => expect(credits.methods).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Top-up credits")).toHaveValue(500);
    await payFiveDollars();
    await waitFor(() => expect(credits.beginFunding).toHaveBeenCalledTimes(2));
    const [first, second] = credits.beginFunding.mock.calls.map(
      ([input]) => input,
    );
    expect(second.amountMicrousd).toBe(5_000_000);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("stays blocked when reconnect is canceled or picks another account", async () => {
    credits.beginFunding.mockRejectedValue(expired());
    const reconnect = vi.fn(async () => {
      throw new Error("Aomi Portal is signed into a different account.");
    });
    checkout(reconnect);
    await payFiveDollars();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reconnect Aomi" }),
    );
    expect(
      await screen.findByText(
        "Aomi Portal is signed into a different account.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reconnect Aomi" }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
    expect(credits.beginFunding).toHaveBeenCalledTimes(1);
  });

  it("asks to reconnect when payment options are refused", async () => {
    credits.methods.mockRejectedValue(
      new AomiCreditApiError(401, "load payment methods"),
    );
    checkout(vi.fn(async () => {}));
    expect(
      await screen.findByRole("button", { name: "Reconnect Aomi" }),
    ).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it("keeps the plain error when the host cannot reconnect", async () => {
    credits.beginFunding.mockRejectedValue(expired());
    checkout();
    await payFiveDollars();
    expect(
      await screen.findByText("Sign in to Aomi again before continuing."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconnect Aomi" })).toBeNull();
  });
});
