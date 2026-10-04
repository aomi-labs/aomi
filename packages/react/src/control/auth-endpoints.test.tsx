import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AomiClient, AomiAppDescriptor } from "@aomi-labs/client";
import { useAuthEndpointsImpl } from "./auth-endpoints";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("shared model and app reads", () => {
  it("starts fresh requests when the client changes within the same access scope", async () => {
    const oldModels = deferred<string[]>();
    const oldApps = deferred<AomiAppDescriptor[]>();
    const oldClient = {
      getModels: vi.fn(() => oldModels.promise),
      getApps: vi.fn(() => oldApps.promise),
    };
    const newClient = {
      getModels: vi.fn().mockResolvedValue(["new-model"]),
      getApps: vi.fn().mockResolvedValue([{ name: "new-app" }]),
    };
    const aomiClientRef = { current: oldClient as unknown as AomiClient };
    const apiKeyRef = { current: null };
    const getControlSessionId = () => "client-session";
    const view = renderHook(() =>
      useAuthEndpointsImpl({
        aomiClientRef,
        apiKeyRef,
        getControlSessionId,
        apiKey: null,
      }),
    );
    aomiClientRef.current = newClient as unknown as AomiClient;
    view.rerender();
    await waitFor(() =>
      expect(view.result.current.state.availableModels).toEqual(["new-model"]),
    );
    expect(view.result.current.state.authorizedApps).toEqual(["new-app"]);
    await act(async () => {
      oldModels.resolve(["old-model"]);
      oldApps.resolve([{ name: "old-app" }]);
    });
    expect(view.result.current.state.availableModels).toEqual(["new-model"]);
    expect(view.result.current.state.authorizedApps).toEqual(["new-app"]);
    expect(newClient.getModels).toHaveBeenCalledOnce();
  });
  it("shares overlapping reads and ignores a stale access-scope response", async () => {
    const models = deferred<string[]>();
    const guestApps = deferred<AomiAppDescriptor[]>();
    const accountApps = deferred<AomiAppDescriptor[]>();
    const client = {
      getModels: vi.fn(() => models.promise),
      getApps: vi
        .fn()
        .mockReturnValueOnce(guestApps.promise)
        .mockReturnValueOnce(accountApps.promise),
    };
    const aomiClientRef = { current: client as unknown as AomiClient };
    const apiKeyRef = { current: null };
    const getControlSessionId = () => "client-session";
    const view = renderHook(
      ({ accountSessionAvailable }) =>
        useAuthEndpointsImpl({
          aomiClientRef,
          apiKeyRef,
          getControlSessionId,
          apiKey: null,
          accountSessionAvailable,
        }),
      { initialProps: { accountSessionAvailable: false } },
    );
    void view.result.current.actions.getAvailableModels();
    void view.result.current.actions.getAuthorizedApps();
    expect(client.getModels).toHaveBeenCalledOnce();
    expect(client.getApps).toHaveBeenCalledOnce();
    view.rerender({ accountSessionAvailable: true });
    await act(async () => {
      accountApps.resolve([{ name: "account-app" }]);
      models.resolve(["model-a"]);
    });
    await waitFor(() =>
      expect(view.result.current.state.authorizedApps).toEqual(["account-app"]),
    );
    await act(async () => guestApps.resolve([{ name: "guest-app" }]));
    expect(view.result.current.state.authorizedApps).toEqual(["account-app"]);
  });

  it("settles a failed model read and permits an explicit retry", async () => {
    const client = {
      getModels: vi
        .fn()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockResolvedValueOnce(["model-a"]),
      getApps: vi.fn().mockResolvedValue([{ name: "default" }]),
    };
    const aomiClientRef = { current: client as unknown as AomiClient };
    const apiKeyRef = { current: null };
    const getControlSessionId = () => "client-session";
    const view = renderHook(() =>
      useAuthEndpointsImpl({
        aomiClientRef,
        apiKeyRef,
        getControlSessionId,
        apiKey: null,
      }),
    );
    await waitFor(() =>
      expect(view.result.current.state.modelsLoading).toBe(false),
    );
    expect(view.result.current.state.modelsError).toBe(true);
    await act(async () => {
      await view.result.current.actions.getAvailableModels();
    });
    expect(view.result.current.state.availableModels).toEqual(["model-a"]);
    expect(view.result.current.state.modelsError).toBe(false);
  });
});
