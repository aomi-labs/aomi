import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AomiClient } from "@aomi-labs/client";
import { useAuthEndpointsImpl } from "./auth-endpoints";

describe("model reads", () => {
  it("includes builder-sponsored provider routes from existing app metadata", async () => {
    const client = {
      getModels: vi.fn().mockResolvedValue(["openai:gpt-6.1-sol"]),
      getApps: vi.fn().mockResolvedValue([
        { name: "partner", metadata: { fundedModelOnly: true, sponsoredModelIds: ["openrouter:openai/gpt-6.1-sol", "openai:gpt-6.1-sol"] } },
      ]),
    };
    const aomiClientRef = { current: client as unknown as AomiClient };
    const apiKeyRef = { current: null };
    const getControlSessionId = () => "sponsored-model-session";
    const view = renderHook(() => useAuthEndpointsImpl({ aomiClientRef, apiKeyRef, getControlSessionId, apiKey: null, credentialRevision: 0 }));
    await waitFor(() => expect(view.result.current.state.availableModels).toEqual([
      "openai:gpt-6.1-sol", "openrouter:openai/gpt-6.1-sol",
    ]));
    await act(async () => {
      expect(await view.result.current.actions.getAvailableModels()).toEqual([
        "openai:gpt-6.1-sol", "openrouter:openai/gpt-6.1-sol",
      ]);
    });
  });

  it("settles a failed model read and permits an explicit retry", async () => {
    const client = {
      getModels: vi
        .fn()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockResolvedValueOnce(["model-a"]),
      getApps: vi.fn().mockResolvedValue([{ name: "default" }]),
    };
    // Stable refs, as the provider passes them, so the mount fetch runs once.
    const aomiClientRef = { current: client as unknown as AomiClient };
    const apiKeyRef = { current: null };
    const getControlSessionId = () => "client-session";
    const view = renderHook(() =>
      useAuthEndpointsImpl({
        aomiClientRef,
        apiKeyRef,
        getControlSessionId,
        apiKey: null,
        credentialRevision: 0,
      }),
    );
    await waitFor(() =>
      expect(view.result.current.state.modelsLoading).toBe(false),
    );
    expect(view.result.current.state.availableModels).toEqual([]);
    await act(async () => {
      await view.result.current.actions.getAvailableModels();
    });
    await waitFor(() =>
      expect(view.result.current.state.availableModels).toEqual(["model-a"]),
    );
    expect(view.result.current.state.modelsLoading).toBe(false);
    expect(client.getModels).toHaveBeenCalledTimes(2);
  });
});
