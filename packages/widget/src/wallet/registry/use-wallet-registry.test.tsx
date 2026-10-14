import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWalletRegistry } from "./use-wallet-registry";
import { SETTLE_QUIET_MS } from "./types";

const executors = {
  wagmiReconnect: async () => undefined,
  wagmiConnect: async () => undefined,
  wagmiDisconnect: async () => undefined,
  providerLogout: async () => undefined,
};

afterEach(() => vi.useRealTimers());

it("settles a signed-out runtime after StrictMode replays its effects", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(
    () => useWalletRegistry({ executors, storageKey: "strict-empty-registry" }),
    { wrapper: StrictMode },
  );
  expect(result.current.state.phase).toBe("booting");
  act(() => vi.advanceTimersByTime(SETTLE_QUIET_MS));
  expect(result.current.state.phase).toBe("stable");
  unmount();
});

it("cancels settlement when the runtime unmounts", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() =>
    useWalletRegistry({ executors, storageKey: "unmounted-empty-registry" }),
  );
  const store = result.current.store;
  unmount();
  act(() => vi.advanceTimersByTime(SETTLE_QUIET_MS));
  expect(store.getSnapshot().phase).toBe("booting");
});
