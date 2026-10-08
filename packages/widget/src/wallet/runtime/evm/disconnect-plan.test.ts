import { describe, expect, it } from "vitest";
import { planEvmAccountDisconnect } from "./disconnect-plan";

const connections = [
  {
    connectorId: "para",
    connectorName: "Para",
    address: "0xAAA" as const,
    chainId: 1,
  },
  {
    connectorId: "mm",
    connectorName: "MetaMask",
    address: "0xAAA" as const,
    chainId: 1,
  },
  {
    connectorId: "rabby",
    connectorName: "Rabby",
    address: "0xBBB" as const,
    chainId: 1,
  },
];

describe("planEvmAccountDisconnect", () => {
  it("disconnects only the managed provider connector when a same-address external wallet remains", () => {
    const plan = planEvmAccountDisconnect({
      target: {
        id: "para",
        address: "0xAAA",
        manageable: true,
        connectorIds: ["para", "mm"],
      },
      connections,
    });

    expect([...plan.connectorIds]).toEqual(["para"]);
    expect(plan.isProviderOwnedAccount).toBe(true);
    expect(plan.otherConnectionsRemain).toBe(true);
    expect(plan.sameAddressConnectionsRemain).toBe(true);
    expect(plan.shouldMarkDroppedAddress).toBe(false);
  });

  it("marks the provider address dropped when no same-address connector remains", () => {
    const plan = planEvmAccountDisconnect({
      target: {
        id: "para",
        address: "0xAAA",
        manageable: true,
        connectorIds: ["para"],
      },
      connections: [connections[0], connections[2]],
    });

    expect([...plan.connectorIds]).toEqual(["para"]);
    expect(plan.otherConnectionsRemain).toBe(true);
    expect(plan.sameAddressConnectionsRemain).toBe(false);
    expect(plan.shouldMarkDroppedAddress).toBe(true);
  });

  it("keeps existing grouped-address behavior for external wallet rows", () => {
    const plan = planEvmAccountDisconnect({
      target: {
        id: "mm",
        address: "0xAAA",
        connectorIds: ["para", "mm"],
      },
      connections,
    });

    expect([...plan.connectorIds]).toEqual(["para", "mm"]);
    expect(plan.isProviderOwnedAccount).toBe(false);
    expect(plan.sameAddressConnectionsRemain).toBe(false);
    expect(plan.shouldMarkDroppedAddress).toBe(true);
  });
});
