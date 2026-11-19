import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AomiRuleChange } from "@aomi-labs/client";
import { usePolicyChanges } from "./policy-changes";

const shell = vi.hoisted(() => {
  const getChange = vi.fn();
  return { getChange, aomi: { account: { rules: { getChange } } } };
});
const { getChange } = shell;
// The shell's client is one object for the life of the page.
vi.mock("@/account/transport", () => ({ useShellAomi: () => shell.aomi }));
vi.mock("@/account/rules/rule-change-card", () => ({
  RuleChangeCard: () => null,
}));

const change = (id: string, state: string) =>
  ({ id, state, wallet_name: "Trading" }) as unknown as AomiRuleChange;

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
