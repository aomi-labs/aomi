import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { WalletIconSlot } from "./wallet-icon-slot";

const sdkLoads = vi.hoisted(() => ({ privy: vi.fn(), para: vi.fn() }));
vi.mock("@/wallet/providers/privy/privy-plugin", () => {
  sdkLoads.privy();
  return { privyPlugin: { id: "privy" } };
});
vi.mock("@/wallet/providers/para/para-plugin", () => {
  sdkLoads.para();
  return { paraPlugin: { id: "para" } };
});

afterEach(cleanup);

it.each(["privy", "para"] as const)(
  "shows the %s mark before SDK boot and after an external wallet connects",
  async (provider) => {
    const label = provider === "privy" ? "Privy" : "Para";
    const view = render(<WalletIconSlot id={label} label={label} />);
    const mark = screen.getByTitle(label);
    expect(mark).toHaveAttribute("data-wallet-brand", provider);
    expect(mark.querySelector("svg")).toHaveAttribute(
      "viewBox",
      provider === "privy" ? "0 0 37.32 48" : "-1 -1 27 26",
    );
    expect(mark).toHaveStyle({ width: "36px", height: "36px" });
    view.rerender(
      <>
        <WalletIconSlot id={label} label={label} />
        <WalletIconSlot id="rabby-wallet" label="Rabby" provider="siwe" />
      </>,
    );
    expect(screen.getByTitle(label)).toHaveAttribute("data-wallet-brand", provider);
    expect(screen.getByTitle("Rabby")).toHaveAttribute("data-wallet-brand", "rabby");
    expect(sdkLoads.privy).not.toHaveBeenCalled();
    expect(sdkLoads.para).not.toHaveBeenCalled();
  },
);
