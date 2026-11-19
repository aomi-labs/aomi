import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PoliciesFixture } from "./policies-fixture";

const card = () => screen.getByRole("region", { name: "london-test policies" });
const rows = () =>
  [...card().querySelectorAll("[data-policy]")] as HTMLElement[];

const vault = () => document.querySelector("[data-vault]") as HTMLElement;
/** The fixture, once its sample vault has read its sample balances. */
async function show() {
  render(<PoliciesFixture />);
  await screen.findByText("USDC 95.00 · ETH 0.98");
}

describe("/dev/policies fixture", () => {
  it("draws the Policies tab on sample data with the tab's own components", async () => {
    await show();
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

  it("shows a removed policy of each kind after the live ones, and drops it once signed", async () => {
    await show();
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

  it("adds a policy from the picker and closes it, all in memory", async () => {
    await show();
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

  it("shows the wallet popup's counts", async () => {
    await show();
    fireEvent.click(screen.getByRole("radio", { name: "Wallet popup" }));
    const summary = document.querySelector(
      "[data-wallet-policy-summary]",
    ) as HTMLElement;
    expect(summary).toHaveTextContent("Connections3");
    // The ended sample policy is not counted, nor are the removed ones.
    expect(summary).toHaveTextContent("Policies6");
  });

  it("shows the owner's vault in the first wallet's card, after the policies and before who may change them", async () => {
    await show();
    const row = vault();
    expect(card().contains(row)).toBe(true);
    expect(row).toHaveTextContent("Vault");
    expect(within(row).getByRole("img")).toHaveAttribute("aria-label", "Base");
    // After the removed policies, before the authority picker.
    const order = [
      ...card().querySelectorAll(
        "[data-policy-removed], [data-vault], [data-policy-authority]",
      ),
    ];
    expect(order.at(-2)).toBe(row);
    expect(order.at(-1)).toHaveAttribute("data-policy-authority");
    expect(
      screen
        .getByRole("region", { name: "trading-bot policies" })
        .querySelector("[data-vault]"),
    ).toBeNull();
    expect(document.querySelectorAll("[data-vault]")).toHaveLength(1);
  });

  it("clicks the vault through: withdraw some USDC, then the rest, on sample balances", async () => {
    await show();
    const row = vault();
    fireEvent.click(within(row).getByRole("button", { name: "Withdraw" }));
    fireEvent.change(within(row).getByRole("textbox", { name: "Amount" }), {
      target: { value: "20" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Sign and send" }));
    expect(
      within(row).getByRole("button", { name: "Waiting for wallet…" }),
    ).toBeDisabled();
    await waitFor(() => expect(row).toHaveTextContent("Withdrawn."));
    await waitFor(() => expect(row).toHaveTextContent("USDC 75.00 · ETH 0.98"));
    // Max takes ETH to zero, and a vault with nothing in a token stops offering it.
    fireEvent.click(within(row).getByRole("button", { name: "Withdraw" }));
    fireEvent.click(within(row).getByRole("button", { name: "ETH" }));
    fireEvent.click(within(row).getByRole("button", { name: "Max" }));
    fireEvent.click(within(row).getByRole("button", { name: "Sign and send" }));
    await waitFor(() => expect(row).not.toHaveTextContent("ETH 0.98"));
    expect(row).toHaveTextContent("USDC 75.00");
    expect(row).not.toHaveTextContent("ETH 0.00");
  });
});
