import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AomiClient } from "@aomi-labs/client";
import { useAuthEndpointsImpl } from "./auth-endpoints";

describe("model reads", () => {
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
      }),
    );
    await waitFor(() =>
      expect(view.result.current.state.modelsLoading).toBe(false),
    );
    expect(view.result.current.state.availableModels).toEqual([]);
    await act(async () => {
      await view.result.current.actions.getAvailableModels();
    });
    expect(view.result.current.state.availableModels).toEqual(["model-a"]);
    expect(view.result.current.state.modelsLoading).toBe(false);
    expect(client.getModels).toHaveBeenCalledTimes(2);
  });
});
