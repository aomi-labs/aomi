import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn(async () => undefined);
const bind = vi.fn(async () => true);
let requiresBinding = true;
let events: Array<{
  type: "tool_complete";
  sequence: number;
  result: unknown;
}> = [];

vi.mock("@aomi-labs/react", () => ({
  useAomiRuntime: () => ({ events, sendMessage }),
}));

vi.mock("@aomi-labs/widget-lib", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));

vi.mock("./use-svm-wallet-binding", () => ({
  useSvmWalletBinding: () => ({
    bind,
    binding: false,
    canBind: requiresBinding,
    requiresBinding,
  }),
}));

import { SvmWalletBindingGate } from "./svm-wallet-binding-gate";

describe("SvmWalletBindingGate", () => {
  beforeEach(() => {
    bind.mockClear();
    sendMessage.mockClear();
    requiresBinding = true;
    events = [];
  });

  it("offers binding from the canonical tool event and retries after success", async () => {
    const view = render(<SvmWalletBindingGate />);
    events = [
      {
        type: "tool_complete",
        sequence: 1,
        result: { error: { type: "signing_unbound_wallet" } },
      },
    ];
    view.rerender(<SvmWalletBindingGate />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Bind wallet and retry" }),
    );
    await waitFor(() => expect(bind).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith(
      "Retry the previous Solana transaction now that the wallet is bound.",
    );
  });

  it("does not offer account binding to external Solana wallets", () => {
    requiresBinding = false;
    events = [
      {
        type: "tool_complete",
        sequence: 1,
        result: { error: { type: "signing_unbound_wallet" } },
      },
    ];
    render(<SvmWalletBindingGate />);
    expect(
      screen.queryByRole("button", { name: "Bind wallet and retry" }),
    ).toBeNull();
  });
});
