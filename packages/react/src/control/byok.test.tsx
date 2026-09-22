import { act, renderHook, waitFor } from "@testing-library/react";
import { AomiClient } from "@aomi-labs/client";
import type { AomiByokKeyEntry } from "@aomi-labs/client";
import { describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useByokImpl } from "./byok";

const getControlSessionId = () => "byok-test";
const entry: AomiByokKeyEntry = {
  provider: "openai",
  key_prefix: "sk-test",
  label: null,
  is_active: true,
};
const client = () =>
  new AomiClient({ baseUrl: "http://localhost:8080", guest: false });

function useHarness({
  current,
  available,
}: {
  current: AomiClient;
  available: boolean;
}) {
  const aomiClientRef = useRef(current);
  aomiClientRef.current = current;
  const clientIdRef = useRef<string | null>("client");
  return useByokImpl({
    aomiClientRef,
    accountClient: available ? current : null,
    clientIdRef,
    getControlSessionId,
  });
}

describe("account model-key readiness", () => {
  it("waits for account auth, fetches on sign-in, and clears on sign-out", async () => {
    const current = client();
    const list = vi.spyOn(current, "listByokKeys").mockResolvedValue([entry]);
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { current, available: false },
    });
    expect(list).not.toHaveBeenCalled();
    await expect(
      result.current.actions.setByok("openai", "key"),
    ).rejects.toThrow("Sign in");
    rerender({ current, available: true });
    await waitFor(() =>
      expect(result.current.state.byokKeys.openai).toEqual(entry),
    );
    rerender({ current, available: false });
    expect(result.current.state.byokKeys).toEqual({});
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("refetches for a changed account client and ignores the previous response", async () => {
    const first = client();
    const second = client();
    let completeFirst!: (entries: AomiByokKeyEntry[]) => void;
    vi.spyOn(first, "listByokKeys").mockReturnValue(
      new Promise((resolve) => {
        completeFirst = resolve;
      }),
    );
    const next = vi.spyOn(second, "listByokKeys").mockResolvedValue([]);
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { current: first, available: true },
    });
    rerender({ current: second, available: true });
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    await act(async () => completeFirst([entry]));
    expect(result.current.state.byokKeys).toEqual({});
  });

  it("does not restore keys when a save finishes after sign-out", async () => {
    const current = client();
    vi.spyOn(current, "listByokKeys").mockResolvedValue([]);
    let completeSave!: (entry: AomiByokKeyEntry) => void;
    vi.spyOn(current, "saveByokKey").mockReturnValue(
      new Promise((resolve) => {
        completeSave = resolve;
      }),
    );
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { current, available: true },
    });
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.actions.setByok("openai", "key");
    });
    rerender({ current, available: false });
    await act(async () => {
      completeSave(entry);
      await saving;
    });
    expect(result.current.state.byokKeys).toEqual({});
  });

  it("reports authenticated API failures", async () => {
    const current = client();
    const failure = new Error("Service unavailable");
    vi.spyOn(current, "listByokKeys").mockRejectedValue(failure);
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderHook(useHarness, { initialProps: { current, available: true } });
    await waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        "Failed to load account model keys:",
        failure,
      ),
    );
    logged.mockRestore();
  });
});
