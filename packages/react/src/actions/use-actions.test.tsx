import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActionAttempt, Session } from "@aomi-labs/client";
import { useActions } from "./use-actions";

describe("action display subscription", () => {
  it("ignores unrelated text publishes but immediately observes attempt state and errors", () => {
    const listeners = new Set<() => void>();
    const attempts = new Map<string, ActionAttempt>();
    const actions: [] = [];
    const session = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => ({
        actions,
        actionAttempts: new Map(
          [...attempts].map(([id, attempt]) => [id, { ...attempt }]),
        ),
      }),
      actions: { isBlocking: () => false },
    } as unknown as Session;
    const rendered = vi.fn();
    const view = renderHook(() => {
      rendered();
      return useActions(session);
    });
    const initial = view.result.current;
    act(() => {
      for (let event = 0; event < 10; event++)
        for (const listener of listeners) listener();
    });
    expect(rendered).toHaveBeenCalledOnce();
    expect(view.result.current).toBe(initial);
    act(() => {
      attempts.set("wallet", {
        actionId: "wallet",
        revision: 1,
        state: "responding",
      });
      for (const listener of listeners) listener();
    });
    expect(view.result.current.actionAttempts.get("wallet")?.state).toBe(
      "responding",
    );
    const error = new Error("Wallet rejected");
    act(() => {
      attempts.set("wallet", {
        actionId: "wallet",
        revision: 1,
        state: "failed",
        error,
      });
      for (const listener of listeners) listener();
    });
    expect(view.result.current.actionAttempts.get("wallet")?.error).toBe(error);
    act(() => {
      attempts.clear();
      for (const listener of listeners) listener();
    });
    expect(view.result.current.actionAttempts.size).toBe(0);
  });
});
