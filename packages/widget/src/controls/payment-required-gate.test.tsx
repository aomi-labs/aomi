import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dismissNotification: vi.fn(),
  setByok: vi.fn(),
  setInferenceFunding: vi.fn(),
}));
vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useNotification: () => ({
    notifications: [{ id: "payment", kind: "payment_required" }],
    dismissNotification: mocks.dismissNotification,
    showNotification: vi.fn(),
  }),
  useControl: () => mocks,
}));

import { PaymentRequiredGate } from "./payment-required-gate";

describe("out-of-credit recovery", () => {
  it("links to the credit dialog without changing funding or saving a key", () => {
    render(<PaymentRequiredGate />);
    const link = screen.getByRole("link", { name: "Add credits on Aomi" });
    expect(link).toHaveAttribute(
      "href",
      "https://chat.aomi.dev/?topup=credits",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/same Aomi account/)).toBeTruthy();
    expect(mocks.setByok).not.toHaveBeenCalled();
    expect(mocks.setInferenceFunding).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save and use BYOK" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(mocks.dismissNotification).toHaveBeenCalledWith("payment");
  });
});
