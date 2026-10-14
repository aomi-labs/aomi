import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@aomi-labs/client";
import { useActions } from "../actions/use-actions";
import { ExtUserProvider, useUser } from "../contexts/ext-user-context";

describe("runtime helper identity across unrelated parent renders", () => {
  it("retains the action facade while its session slices do not change", () => {
    const snapshot = { actions: [], actionAttempts: new Map() };
    const session = {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      actions: {
        isBlocking: () => false,
        execute: vi.fn(),
        submitResult: vi.fn(),
        reject: vi.fn(),
      },
    } as unknown as Session;
    const view = renderHook(() => useActions(session));
    const results = new Set([view.result.current]);
    for (let i = 0; i < 10; i++) {
      view.rerender();
      results.add(view.result.current);
    }
    expect(results.size).toBe(1);
  });
  it("retains the user facade across ten unchanged provider renders", () => {
    const view = renderHook(() => useUser(), { wrapper: ExtUserProvider });
    const results = new Set([view.result.current]);
    for (let i = 0; i < 10; i++) {
      view.rerender();
      results.add(view.result.current);
    }
    expect(results.size).toBe(1);
  });
});
