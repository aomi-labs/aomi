import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopedStorage } from "@aomi-labs/client";
import { FakeAgentBackend } from "../../../../tests/e2e/fake-backend/backend";
import {
  useControl,
  type ControlContextApi,
} from "../contexts/control-context";
import { useAomiRuntime, type AomiRuntimeApi } from "../interface";
import { AomiRuntimeProvider } from "./aomi-runtime";

afterEach(() => localStorage.clear());

describe("model selection on chat requests", () => {
  it.each(["manual", "auto"] as const)(
    "keeps %s model selection separate from backend supplier routing",
    async (mode) => {
      const backendUrl = "https://model-selection.example";
      const model = "openai:gpt-6-luna";
      const catalog = ["openai:gpt-6.1-sol", model];
      createScopedStorage({ backendUrl }).set(
        "modelSelection",
        JSON.stringify({ mode, model: "openrouter:openai/gpt-6-luna" }),
      );
      const backend = new FakeAgentBackend();
      const starts: Record<string, unknown>[] = [];
      const fetch = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/models")) return Response.json(catalog);
          if (url.pathname.endsWith("/apps"))
            return Response.json([
              {
                name: "partner",
                metadata: {
                  fundedModelOnly: true,
                  sponsoredModelIds: ["openrouter:openai/gpt-6-luna"],
                },
              },
            ]);
          const body = init?.body ? JSON.parse(String(init.body)) : undefined;
          if (url.pathname === "/v1/agent/chat" && init?.method === "POST")
            starts.push(body);
          const result = await backend.handle({
            method: init?.method ?? "GET",
            url,
            headers: Object.fromEntries(new Headers(init?.headers)),
            body,
          });
          if (result.kind !== "json")
            throw new Error("Expected a settled turn");
          return Response.json(result.body, { status: result.status });
        },
      );
      let runtime!: AomiRuntimeApi;
      let control!: ControlContextApi;
      function Capture() {
        runtime = useAomiRuntime();
        control = useControl();
        return null;
      }
      render(
        <AomiRuntimeProvider
          backendUrl={backendUrl}
          clientOptions={{ fetch, guest: false }}
          accountSessionAvailable
          persistThread={false}
          displayPersistence="none"
        >
          <Capture />
        </AomiRuntimeProvider>,
      );
      await waitFor(() => {
        expect(control.state.availableModels).toEqual(catalog);
        expect(control.getCurrentThreadControl()).toMatchObject({
          model: mode === "manual" ? model : "openai:gpt-6.1-sol",
          modelMode: mode,
        });
      });
      await act(() => runtime.sendMessage("Hello"));
      expect(starts).toHaveLength(1);
      if (mode === "manual") expect(starts[0].model).toBe(model);
      else expect(starts[0]).not.toHaveProperty("model");
      expect(starts[0]).not.toHaveProperty("applicationId");
      expect(starts[0]).not.toHaveProperty("provider");
    },
  );
});
