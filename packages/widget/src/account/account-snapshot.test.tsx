import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DisplayCacheProvider,
  type RuntimeAccount,
} from "../../../react/src/query/display-cache";
import type { ReactNode } from "react";
import { useAccountSnapshot } from "./account-snapshot";

const key = "aomi:account-chip:/backend|8";
const saved = {
  accountId: "a",
  name: "Ada",
  wallets: [],
  creditsLine: "498",
  planLabel: "Free",
};
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function wrapper(account: RuntimeAccount | null | undefined) {
  return function SnapshotScope({ children }: { children: ReactNode }) {
    return (
      <DisplayCacheProvider
        backendUrl="/backend/"
        applicationId={8}
        account={account}
        persistence="none"
      >
        {children}
      </DisplayCacheProvider>
    );
  };
}

describe("account snapshot display fields", () => {
  it("reads credits and plan on the first client render", () => {
    window.localStorage.setItem(key, JSON.stringify(saved));
    const renders: unknown[] = [];
    renderHook(
      () => {
        const [snapshot] = useAccountSnapshot();
        renders.push(snapshot);
      },
      { wrapper: wrapper(undefined) },
    );
    expect(renders[0]).toEqual(saved);
  });

  it("accepts old snapshots and ignores malformed optional fields", () => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...saved, creditsLine: 498, planLabel: null }),
    );
    const view = renderHook(useAccountSnapshot, {
      wrapper: wrapper(undefined),
    });
    expect(view.result.current[0]).toEqual({
      accountId: "a",
      name: "Ada",
      wallets: [],
    });
    act(() => view.result.current[1](null));
    expect(view.result.current[0]).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it.each([
    null,
    { kind: "user", id: "b" } as const,
    { kind: "guest", id: "a" } as const,
  ])("does not display the old account for %j", (account) => {
    window.localStorage.setItem(key, JSON.stringify(saved));
    const view = renderHook(useAccountSnapshot, { wrapper: wrapper(account) });
    expect(view.result.current[0]).toBeNull();
  });

  it("isolates backend and app scopes", () => {
    window.localStorage.setItem(key, JSON.stringify(saved));
    const view = renderHook(useAccountSnapshot, {
      wrapper: ({ children }) => (
        <DisplayCacheProvider
          backendUrl="/other"
          applicationId={8}
          account={undefined}
          persistence="none"
        >
          {children}
        </DisplayCacheProvider>
      ),
    });
    expect(view.result.current[0]).toBeNull();
  });
});
