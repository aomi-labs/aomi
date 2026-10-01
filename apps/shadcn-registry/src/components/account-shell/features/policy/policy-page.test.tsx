import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() =>
  vi.fn(async (_path: string) => ({
    mode: "balanced",
    revision: 1,
    scope: "account_default",
    source: "default",
  })),
);
vi.mock("../../transport", () => ({
  useShellTransport: () => ({ json: request }),
}));
vi.mock("../account/provider-policy-settings", () => ({
  SigningSettings: () => <div>Signing rows</div>,
}));
vi.mock("../../../../lib/wallet-kit/context", () => ({
  useAomiWalletKit: () => {
    throw new Error("Swig settings must not mount");
  },
}));
import { PolicyPage } from "./policy-page";

describe("Safety page", () => {
  it("shows the default level and signing, with Swig limits hidden", async () => {
    render(<PolicyPage />);
    expect(
      await screen.findByRole("radiogroup", {
        name: "Guard policy",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Signing rows")).toBeTruthy();
    expect(screen.queryByText("Swig on Solana")).toBeNull();
    expect(
      request.mock.calls.some(([path]) => String(path).includes("onchain")),
    ).toBe(false);
  });
});
