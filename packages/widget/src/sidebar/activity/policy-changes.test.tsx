import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AomiPolicyChange, AomiWalletPolicies } from "@aomi-labs/client";
import { usePolicyChanges, usePolicyWallets } from "./policy-changes";

const shell = vi.hoisted(() => {
  const getChange = vi.fn();
  const get = vi.fn();
  const catalog = vi.fn();
  return {
    getChange,
    get,
    catalog,
    aomi: { account: { policy: { getChange, get, catalog } } },
  };
});
const { getChange } = shell;
// Which rows wait to be signed is policyRows' call; here it is the test's.
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("@/account/policies/policy-model", async (original) => ({
  ...(await original<object>()),
  policyRows: () => rows.current,
}));
// The shell's client is one object for the life of the page.
vi.mock("@/account/transport", () => ({ useShellAomi: () => shell.aomi }));
vi.mock("@/account/policies/policy-change-card", () => ({
  PolicyChangeCard: () => null,
}));

const change = (id: string, state: string) =>
  ({ id, state, wallet_name: "Trading" }) as unknown as AomiPolicyChange;

describe("usePolicyChanges", () => {
  beforeEach(() => getChange.mockReset());

  it("keeps the changes that still wait and drops replaced, decided and unreadable ones", async () => {
    getChange.mockImplementation(async (id: string) => {
      if (id === "gone") throw new Error("not yours");
      return change(id, id === "open" ? "awaiting_admin" : "superseded");
    });
    const { result } = renderHook(() =>
      usePolicyChanges(["old", "open", "gone"]),
    );
    await waitFor(() => expect(result.current.changes).toHaveLength(1));
    expect(result.current.changes[0].id).toBe("open");
  });

  it("shows nothing without a filed change and removes one the owner decided", async () => {
    getChange.mockResolvedValue(change("c1", "awaiting_admin"));
    const none = renderHook(() => usePolicyChanges([]));
    expect(none.result.current.changes).toEqual([]);
    expect(getChange).not.toHaveBeenCalled();

    const { result } = renderHook(() => usePolicyChanges(["c1"]));
    await waitFor(() => expect(result.current.changes).toHaveLength(1));
    act(() => result.current.drop("c1"));
    expect(result.current.changes).toEqual([]);
  });
});

describe("usePolicyWallets", () => {
  const wallet = { agent_wallet_id: "w1", wallet_name: "Trading" };
  beforeEach(() => {
    shell.get.mockReset().mockResolvedValue(wallet as AomiWalletPolicies);
    shell.catalog.mockReset().mockResolvedValue({ tokens: [] });
  });

  it("offers the wallets whose policies wait for a signature on chain", async () => {
    rows.current = [{ id: "r1", enforcement: { name: "Swig", deploy: "k" } }];
    const { result } = renderHook(() => usePolicyWallets(["w1", "w1"]));
    await waitFor(() => expect(result.current.signing).toHaveLength(1));
    expect(result.current.signing[0].rows).toHaveLength(1);
    // One wallet filed twice is read once per read, not twice.
    expect(shell.get).toHaveBeenCalledTimes(1);
    expect(shell.get).toHaveBeenCalledWith("w1");
  });

  it("shows nothing once no policy waits for a signature", async () => {
    rows.current = [{ id: "r1", enforcement: { name: "Swig" } }];
    const { result } = renderHook(() => usePolicyWallets(["w1"]));
    await waitFor(() => expect(shell.get).toHaveBeenCalled());
    expect(result.current.signing).toEqual([]);
    const idle = renderHook(() => usePolicyWallets([]));
    expect(idle.result.current.signing).toEqual([]);
  });
});
