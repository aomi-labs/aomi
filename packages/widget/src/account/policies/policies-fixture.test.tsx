import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PoliciesFixture } from "./policies-fixture";

const card = () => screen.getByRole("region", { name: "london-test policies" });
const rows = () =>
  [...card().querySelectorAll("[data-policy]")] as HTMLElement[];

describe("/dev/policies fixture", () => {
  it("draws the Policies tab on sample data with the tab's own components", () => {
    render(<PoliciesFixture />);
    expect(screen.getByRole("heading", { name: "Policies" })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Policy change for london-test" }),
    ).toBeTruthy();
    expect(rows()).toHaveLength(7);
    const [op, base, sol, waiting, merged, blocked, ended] = rows();
    // Each chain of a deployed policy is its own row, with what is left.
    expect(op).toHaveTextContent("Up to 1,000 USDC on any protocol");
    expect(within(op!).getByRole("img")).toHaveAttribute("aria-label", "OP");
    expect(op).toHaveTextContent("Active period: 11/11/2026 – 11/12/2026");
    expect(within(op!).getByRole("link", { name: "MetaMask" })).toBeTruthy();
    expect(op).toHaveTextContent("· 640 USDC left");
    expect(base).toHaveTextContent("· 1,000 USDC left");
    expect(base).toHaveTextContent("· chain ends 14/12/2026");
    expect(sol).toHaveTextContent("· 7.2 SOL left");
    // Chains in the same state share a row.
    expect(
      within(merged!)
        .getAllByRole("img")
        .map((mark) => mark.getAttribute("aria-label")),
    ).toEqual(["Ethereum", "OP"]);
    expect(merged).toHaveTextContent("Total not enforced");
    expect(blocked).toHaveTextContent("No USDT on Jupiter");
    expect(ended).toHaveTextContent("Ended 31/10/2026");
    // Signing the deployment gives the row its link and its start.
    expect(waiting).toHaveTextContent("starts when you sign");
    fireEvent.click(
      within(waiting!).getByRole("button", { name: "Sign to deploy" }),
    );
    expect(
      within(rows()[3]!).getByRole("link", { name: "MetaMask" }),
    ).toBeTruthy();
    expect(rows()[3]).toHaveTextContent("· 1,000 USDC left");
  });

  it("shows a removed policy of each kind after the live ones, and drops it once signed", () => {
    render(<PoliciesFixture />);
    const removed = () =>
      [...card().querySelectorAll("[data-policy-removed]")] as HTMLElement[];
    // Not live policies: the seven rows above are unchanged.
    expect(rows()).toHaveLength(7);
    const [grant, sent, role] = removed();
    expect(removed()).toHaveLength(3);
    expect(grant).toHaveTextContent("Removed · USDC on Aave");
    expect(within(grant!).getByRole("img")).toHaveAttribute(
      "aria-label",
      "Base",
    );
    expect(grant).toHaveTextContent("Onchain Enforcement:MetaMask");
    expect(grant).toHaveTextContent("· 5 USDC left");
    expect(grant).toHaveTextContent("This rule was removed or has ended.");
    // The owner already signed this one's revocation: the step is to send it.
    expect(sent).toHaveTextContent("Removed · USDC on Morpho");
    expect(sent).toHaveTextContent("· 3 USDC left");
    expect(sent).toHaveTextContent("Your revocation is signed. Send it from");
    expect(
      within(sent!).getByRole("button", { name: "Send revocation" }),
    ).toBeTruthy();
    expect(
      within(sent!).queryByRole("button", { name: "Sign to take off" }),
    ).toBeNull();
    expect(
      within(grant!).queryByRole("button", { name: "Send revocation" }),
    ).toBeNull();
    expect(role).toHaveTextContent("Removed · SOL on Orca");
    expect(role).toHaveTextContent("Onchain Enforcement:Swig");
    expect(role).toHaveTextContent("· 2.5 SOL left");
    for (const row of [grant!, sent!, role!]) {
      expect(row).not.toHaveTextContent("Active period");
      expect(
        within(row).queryByRole("button", { name: /Remove the policy/ }),
      ).toBeNull();
    }
    fireEvent.click(
      within(grant!).getByRole("button", { name: "Sign to take off" }),
    );
    expect(removed()).toHaveLength(2);
    expect(removed()[0]).toHaveTextContent("Removed · USDC on Morpho");
    fireEvent.click(
      within(removed()[0]!).getByRole("button", { name: "Send revocation" }),
    );
    expect(removed()).toHaveLength(1);
    expect(removed()[0]).toHaveTextContent("Removed · SOL on Orca");
    expect(rows()).toHaveLength(7);
  });

  it("adds a policy from the picker and closes it, all in memory", () => {
    render(<PoliciesFixture />);
    fireEvent.click(within(card()).getByRole("button", { name: "Policy" }));
    fireEvent.click(screen.getByRole("button", { name: "SOL" }));
    fireEvent.click(screen.getByRole("button", { name: "Orca" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Total amount" }), {
      target: { value: "5" },
    });
    fireEvent.click(within(card()).getByRole("button", { name: "Policy" }));
    expect(card().querySelector("[data-policy-picker]")).toBeNull();
    expect(rows()[0]).toHaveTextContent("Up to 5 SOL on Orca");
    expect(rows()[0]).toHaveTextContent("Onchain Enforcement:Swig");
  });

  it("shows the wallet popup's counts", () => {
    render(<PoliciesFixture />);
    fireEvent.click(screen.getByRole("radio", { name: "Wallet popup" }));
    const summary = document.querySelector(
      "[data-wallet-policy-summary]",
    ) as HTMLElement;
    expect(summary).toHaveTextContent("Connections3");
    // The ended sample policy is not counted, nor are the removed ones.
    expect(summary).toHaveTextContent("Policies6");
  });
});
