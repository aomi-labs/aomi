import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dismissNotification: vi.fn(),
  baseUrl: "",
}));
vi.mock("@/account/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/account/transport")>();
  return {
    ...actual,
    useShellTransport: () => ({
      ...actual.createShellTransport(),
      baseUrl: mocks.baseUrl,
    }),
  };
});
vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useNotification: () => ({
    notifications: [{ id: "payment", kind: "payment_required" }],
    dismissNotification: mocks.dismissNotification,
    showNotification: vi.fn(),
  }),
}));

import { PaymentRequiredGate } from "./payment-required-gate";

describe("out-of-credit recovery", () => {
  it("links to the credit dialog without changing funding or saving a key", () => {
    render(<PaymentRequiredGate />);
    const link = screen.getByRole("link", { name: "Add credits on Aomi" });
    expect(link).toHaveAttribute(
      "href",
      "/?topup=credits",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/same Aomi account/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save and use BYOK" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(mocks.dismissNotification).toHaveBeenCalledWith("payment");
  });

  it("sends staging users to the staging host they are already using", () => {
    mocks.baseUrl = "https://chat-staging.aomi.dev";
    render(<PaymentRequiredGate />);
    expect(
      screen.getByRole("link", { name: "Add credits on Aomi" }),
    ).toHaveAttribute("href", "https://chat-staging.aomi.dev/?topup=credits");
    expect(screen.getByText(/chat-staging\.aomi\.dev/)).toBeTruthy();
    mocks.baseUrl = "";
  });
});
