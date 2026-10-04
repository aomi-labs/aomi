import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCreditAllowanceStore,
  useCreditAllowance,
} from "./use-credit-allowance";

const session = vi.hoisted(() => ({
  id: undefined as string | undefined,
  guest: false,
  request: vi.fn(),
}));
vi.mock("../../../lib/wallet-kit/context", () => ({
  useAomiWalletKit: () => ({
    accountUser: session.id ? { id: session.id } : undefined,
    accountGuest: session.guest,
  }),
}));
vi.mock("../transport", () => ({
  useShellTransport: () => ({ json: session.request }),
}));
afterEach(() => {
  session.request.mockReset();
  session.id = undefined;
  session.guest = false;
});

describe("shared account allowance", () => {
  it("retains its successful value while refresh is pending and after failure", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      included_limit: 1_000_000,
      included_used: 120_000,
    });
    const store = createCreditAllowanceStore(request);
    await store.refresh();
    expect(store.snapshot().data).toEqual({ included: 100, used: 12 });
    let reject!: (reason: Error) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((_, failure) => {
          reject = failure;
        }),
    );
    const pending = store.refresh(true);
    expect(store.snapshot()).toMatchObject({
      status: "loading",
      data: { included: 100, used: 12 },
    });
    reject(new Error("unavailable"));
    await pending;
    expect(store.snapshot()).toMatchObject({
      status: "error",
      data: { included: 100, used: 12 },
    });
  });

  it("waits for a canonical account and shares one read across consumers", async () => {
    session.request.mockResolvedValue({
      included_limit: 1_000_000,
      included_used: 120_000,
    });
    const a = renderHook(() => useCreditAllowance());
    const b = renderHook(() => useCreditAllowance());
    await act(async () => {
      await a.result.current.refresh();
    });
    expect(session.request).not.toHaveBeenCalled();
    session.id = "dedup-account";
    a.rerender();
    b.rerender();
    await waitFor(() => expect(a.result.current.status).toBe("ready"));
    expect(session.request).toHaveBeenCalledTimes(1);
    expect(b.result.current.data?.included).toBe(100);
  });

  it("does not probe the signed-in allowance for a guest account on retry", async () => {
    session.id = "guest-account";
    session.guest = true;
    const view = renderHook(() => useCreditAllowance());
    await act(async () => {
      await view.result.current.refresh();
    });
    expect(session.request).not.toHaveBeenCalled();
    expect(view.result.current.data).toBeUndefined();
  });

  it("keeps a late response for the previous account out of the new account view", async () => {
    let resolveA!: (data: unknown) => void;
    let resolveB!: (data: unknown) => void;
    session.request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          }),
      );
    session.id = "old-account";
    const view = renderHook(() => useCreditAllowance());
    session.id = "new-account";
    view.rerender();
    expect(view.result.current.data).toBeUndefined();
    await act(async () => {
      resolveA({ included_limit: 9_000_000, included_used: 0 });
    });
    expect(view.result.current.data).toBeUndefined();
    await act(async () => {
      resolveB({ included_limit: 2_000_000, included_used: 0 });
    });
    expect(view.result.current.data?.included).toBe(200);
  });
});
