import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Aomi } from "@aomi-labs/client";
import { useAuthEndpointsImpl } from "./auth-endpoints";

describe("model reads", () => {
  it("keeps the backend model catalog separate from app-sponsored routes", async () => {
    const catalog = [
      "openai:gpt-6.1-sol",
      "openai:gpt-6-luna",
      "anthropic:claude-opus-5-5",
    ];
    const client = {
      getModels: vi.fn().mockResolvedValue(catalog),
      getApps: vi.fn().mockResolvedValue([
        {
          name: "partner",
          metadata: {
            fundedModelOnly: true,
            sponsoredModelIds: [
              "openrouter:openai/gpt-6.1-sol",
              "openrouter:openai/gpt-6-luna",
              "openrouter:anthropic/claude-opus-5.5",
              "openrouter:unavailable-model",
            ],
          },
        },
      ]),
    };
    const aomiRef = { current: { raw: client } as unknown as Aomi };
    const apiKeyRef = { current: null };
    const getControlSessionId = () => "sponsored-model-session";
    const view = renderHook(() =>
      useAuthEndpointsImpl({
        aomiRef,
        apiKeyRef,
        getControlSessionId,
        apiKey: null,
        credentialRevision: 0,
      }),
    );
    await waitFor(() => {
      expect(view.result.current.state.appDescriptors).toHaveLength(1);
      expect(view.result.current.state.availableModels).toEqual(catalog);
    });
    await act(async () => {
      expect(await view.result.current.actions.getAvailableModels()).toEqual(
        catalog,
      );
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
    const aomiRef = { current: { raw: client } as unknown as Aomi };
    const apiKeyRef = { current: null };
    const getControlSessionId = () => "client-session";
    const view = renderHook(() =>
      useAuthEndpointsImpl({
        aomiRef,
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
