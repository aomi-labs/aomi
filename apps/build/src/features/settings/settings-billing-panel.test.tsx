import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const state = vi.hoisted(() => ({ get: vi.fn(), ledger: vi.fn() }));
vi.mock("@aomi-labs/client", () => ({
  Aomi: class {
    builder = { credits: { get: state.get, ledger: state.ledger } };
  },
}));
vi.mock("@aomi-labs/widget/checkout", () => ({
  CreditCheckoutDialog: ({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess: () => Promise<void>;
  }) =>
    open ? (
      <button onClick={() => void onSuccess()}>Confirm test funding</button>
    ) : null,
}));
vi.mock("@/features/operate/client", () => ({
  operateFetch: vi.fn(async () => ({
    statement: {
      charges: [],
      range: { fromDate: "2026-10-01", toDate: "2026-10-31" },
    },
  })),
}));
import { SettingsBillingPanel } from "./settings-billing-panel";
beforeEach(() => {
  state.ledger
    .mockReset()
    .mockResolvedValue({ entries: [], next_before_id: null });
  state.get
    .mockReset()
    .mockResolvedValue({
      balance_microusd: -10000000,
      debt_microusd: 10000000,
      entries: [],
    });
});
it("uses builder ownership and refreshes debt after shared checkout succeeds", async () => {
  render(<SettingsBillingPanel />);
  expect(await screen.findByText(/Pay \$10.00 to restore/)).toBeInTheDocument();
  state.get.mockResolvedValue({
    balance_microusd: 0,
    debt_microusd: 0,
    entries: [],
  });
  fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm test funding" }));
  expect(await screen.findByText("$0.00")).toBeInTheDocument();
  expect(screen.queryByText(/Pay \$10.00 to restore/)).not.toBeInTheDocument();
});
