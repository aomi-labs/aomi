import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AomiUserAppSecrets } from "@aomi-labs/client";
import { useAppSecretsState } from "./use-app-secrets-state";

const slot = {
  name: "API_KEY",
  description: "Personal API key",
  required: true,
  user_own: true,
};
const status = (configured: boolean): AomiUserAppSecrets => ({
  application_id: 42,
  app: "venue",
  ready: configured,
  missing_required: configured ? [] : [slot.name],
  slots: [{ ...slot, configured, app_provided: false }],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function operations() {
  return {
    list: vi.fn(async () => status(false)),
    save: vi.fn(async () => status(true)),
    remove: vi.fn(async () => true),
  };
}

function setup(api = operations()) {
  const view = renderHook(
    ({ scopeKey }) =>
      useAppSecretsState({
        scopeKey,
        applicationId: 42,
        enabled: true,
        declaredSlots: [slot],
        operations: api,
      }),
    { initialProps: { scopeKey: "account-a:42" } },
  );
  return { ...view, api };
}

describe("useAppSecretsState mutation lifetime", () => {
  it("does not let an opening refresh overwrite a later successful save", async () => {
    const { result, api } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const refresh = deferred<AomiUserAppSecrets>();
    api.list.mockReturnValueOnce(refresh.promise);
    let reading!: Promise<AomiUserAppSecrets | null>;
    act(() => {
      reading = result.current.refresh();
    });
    act(() => {
      result.current.setDraft(slot.name, "replacement");
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status?.ready).toBe(true);
    await act(async () => {
      refresh.resolve(status(false));
      await reading;
    });
    expect(result.current.status?.ready).toBe(true);
  });

  it("ignores a save from an earlier visit to the same scope", async () => {
    const { result, rerender, api } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const save = deferred<AomiUserAppSecrets>();
    api.save.mockReturnValueOnce(save.promise);
    act(() => {
      result.current.setDraft(slot.name, "replacement");
    });
    let saving!: Promise<AomiUserAppSecrets | null>;
    act(() => {
      saving = result.current.save();
    });
    rerender({ scopeKey: "account-b:42" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ scopeKey: "account-a:42" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      save.resolve(status(true));
      expect(await saving).toBeNull();
    });
    expect(result.current.status?.ready).toBe(false);
  });

  it("does not restore deleted credentials from an older refresh", async () => {
    const api = operations();
    api.list.mockResolvedValueOnce(status(true));
    const { result } = setup(api);
    await waitFor(() => expect(result.current.status?.ready).toBe(true));
    const refresh = deferred<AomiUserAppSecrets>();
    api.list.mockReturnValueOnce(refresh.promise);
    let reading!: Promise<AomiUserAppSecrets | null>;
    act(() => {
      reading = result.current.refresh();
    });
    await act(async () => {
      await result.current.remove(slot.name);
    });
    await act(async () => {
      refresh.resolve(status(true));
      await reading;
    });
    expect(result.current.status?.ready).toBe(false);
  });

  it("does not fetch credentials after an obsolete delete completes", async () => {
    const { result, unmount, api } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const deletion = deferred<boolean>();
    api.remove.mockReturnValueOnce(deletion.promise);
    let deleting!: Promise<boolean>;
    act(() => {
      deleting = result.current.remove(slot.name);
    });
    unmount();
    await act(async () => {
      deletion.resolve(true);
      expect(await deleting).toBe(false);
    });
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("keeps a new scope visit loading when an old retry finishes", async () => {
    const { result, rerender, api } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldRead = deferred<AomiUserAppSecrets>();
    const newRead = deferred<AomiUserAppSecrets>();
    api.list
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(status(false))
      .mockReturnValueOnce(newRead.promise);
    let retrying!: Promise<void>;
    act(() => {
      retrying = result.current.retry();
    });
    rerender({ scopeKey: "account-b:42" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ scopeKey: "account-a:42" });
    await act(async () => {
      oldRead.resolve(status(false));
      await retrying;
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      newRead.resolve(status(false));
    });
    expect(result.current.loading).toBe(false);
  });
});
