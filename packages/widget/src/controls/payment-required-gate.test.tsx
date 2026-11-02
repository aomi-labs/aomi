import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dismissNotification: vi.fn(),
  notifications: [{ id: "payment", kind: "payment_required" }],
  refetch: vi.fn(async () => {}),
  credits: vi.fn(() => ({ data: undefined, refetch: mocks.refetch })),
}));
vi.mock("@/account/use-account-credits", () => ({
  useAccountCredits: mocks.credits,
}));
vi.mock("@/account/usage/credits/credit-checkout-dialog", () => ({
  CreditCheckoutDialog: ({
    onSuccess,
    onClose,
  }: {
    onSuccess: () => Promise<void>;
    onClose: () => void;
  }) => (
    <div data-testid="checkout">
      <button onClick={() => void onSuccess()}>Pay</button>
      <button onClick={onClose}>Back</button>
    </div>
  ),
}));
vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useNotification: () => ({
    notifications: mocks.notifications,
    dismissNotification: mocks.dismissNotification,
    showNotification: vi.fn(),
  }),
}));

import { PaymentRequiredGate } from "./payment-required-gate";

describe("out-of-credit recovery", () => {
  beforeEach(() => {
    mocks.notifications = [{ id: "payment", kind: "payment_required" }];
    mocks.credits.mockClear();
    mocks.dismissNotification.mockClear();
  });

  it("only subscribes to the balance while the payment gate is visible", () => {
    mocks.notifications = [];
    const view = render(<PaymentRequiredGate />);
    expect(mocks.credits).not.toHaveBeenCalled();

    mocks.notifications = [{ id: "payment", kind: "payment_required" }];
    view.rerender(<PaymentRequiredGate />);
    expect(mocks.credits).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("opens checkout in the widget without saving a key", async () => {
    render(<PaymentRequiredGate />);
    expect(
      screen.queryByRole("button", { name: "Save and use BYOK" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add funds" }));
    expect(screen.getByTestId("checkout")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Add funds" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add funds" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mocks.dismissNotification).toHaveBeenCalledWith("payment"),
    );
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("dismisses on Not now", () => {
    render(<PaymentRequiredGate />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(mocks.dismissNotification).toHaveBeenCalledWith("payment");
  });
});
