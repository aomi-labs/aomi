import React, { forwardRef, useImperativeHandle } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ControlContextProvider,
  useControl,
  type ControlContextApi,
} from "../control-context";
import {
  initThreadControl,
  type ThreadMetadata,
} from "../../state/thread-store";

type HarnessHandle = {
  control: ControlContextApi;
};

const Harness = forwardRef<HarnessHandle>((_, ref) => {
  const control = useControl();
  useImperativeHandle(ref, () => ({ control }), [control]);
  return null;
});

Harness.displayName = "Harness";

const renderControlContext = (
  clientOverrides?: Record<string, unknown>,
  threadMetadata = new Map<string, ThreadMetadata>(),
) => {
  const ref = React.createRef<HarnessHandle>();
  const aomiClient = {
    getApps: vi.fn(async () => [{ name: "default" }]),
    getModels: vi.fn(async () => []),
    setModel: vi.fn(async () => ({})),
    listByokKeys: vi.fn(async () => []),
    saveByokKey: vi.fn(async () => ({
      provider: "openai",
      key_prefix: "sk-open",
      label: null,
      is_active: true,
    })),
    deleteByokKey: vi.fn(async () => true),
    ingestSecrets: vi.fn(async () => ({ handles: {} })),
    deleteSecret: vi.fn(async () => ({ deleted: true })),
    clearSecrets: vi.fn(async () => ({ cleared: true })),
    listSecrets: vi.fn(async () => ({ by_app: {} })),
    ...clientOverrides,
  };

  const result = render(
    <ControlContextProvider
      aomiClient={aomiClient as never}
      sessionId="session-1"
      getThreadMetadata={(threadId) => threadMetadata.get(threadId)}
      updateThreadMetadata={(threadId, updates) => {
        const previous = threadMetadata.get(threadId);
        if (!previous) return;
        threadMetadata.set(threadId, { ...previous, ...updates });
      }}
    >
      <Harness ref={ref} />
    </ControlContextProvider>,
  );

  if (!ref.current) {
    throw new Error("Harness did not mount");
  }

  return {
    ...result,
    aomiClient,
    getControl: () => ref.current!.control,
    threadMetadata,
  };
};

const createThreadMetadata = () =>
  new Map<string, ThreadMetadata>([
    [
      "session-1",
      {
        title: "New Chat",
        status: "regular",
        control: initThreadControl(),
      },
    ],
  ]);

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("ControlContextProvider", () => {
  it("initializes client id synchronously on first render", () => {
    const { getControl } = renderControlContext();
    expect(getControl().state.clientId).toBeTruthy();
  });

  it("reuses the stored client id across remounts", async () => {
    const first = renderControlContext();

    await waitFor(() => {
      expect(first.getControl().state.clientId).toBeTruthy();
    });

    const firstClientId = first.getControl().state.clientId!;
    expect(globalThis.localStorage.getItem("aomi_client_id")).toBe(
      firstClientId,
    );

    first.unmount();

    const second = renderControlContext();
    await waitFor(() => {
      expect(second.getControl().state.clientId).toBe(firstClientId);
    });
  });

  it("saves and removes BYOK keys through the account model-key API", async () => {
    const saveByokKey = vi.fn(async () => ({
      provider: "openai",
      key_prefix: "sk-open",
      label: null,
      is_active: true,
    }));
    const deleteByokKey = vi.fn(async () => true);
    const { getControl } = renderControlContext({
      saveByokKey,
      deleteByokKey,
    });

    await waitFor(() => {
      expect(getControl().state.clientId).toBeTruthy();
    });

    const clientId = getControl().state.clientId!;

    await act(async () => {
      await getControl().setByok("openai", "sk-openai-123");
    });

    await waitFor(() => {
      expect(getControl().state.byokKeys.openai?.key_prefix).toBe("sk-open");
    });

    await act(async () => {
      await getControl().removeByok("openai");
    });

    await waitFor(() => {
      expect(deleteByokKey).toHaveBeenCalledWith(
        `control:${clientId}`,
        "openai",
      );
    });

    expect(getControl().state.byokKeys.openai).toBeUndefined();
    expect(saveByokKey).toHaveBeenCalledWith(
      `control:${clientId}`,
      "openai",
      "sk-openai-123",
      undefined,
    );
  });

  it("loads redacted BYOK keys from the account model-key API", async () => {
    globalThis.localStorage.setItem("aomi_client_id", "client-stored");
    const listByokKeys = vi.fn(async () => [
      {
        provider: "openai",
        key_prefix: "sk-open",
        label: "Primary",
        is_active: true,
      },
    ]);
    const { getControl } = renderControlContext({ listByokKeys });

    await waitFor(() => {
      expect(getControl().state.byokKeys.openai).toEqual({
        provider: "openai",
        key_prefix: "sk-open",
        label: "Primary",
        is_active: true,
      });
    });
  });

  it("remembers a manually selected model for fresh threads", async () => {
    const threadMetadata = createThreadMetadata();
    const setModel = vi.fn(async () => ({}));
    const { getControl } = renderControlContext(
      {
        getModels: vi.fn(async () => ["gpt-4o-mini", "gpt-5"]),
        setModel,
      },
      threadMetadata,
    );

    await waitFor(() => {
      expect(getControl().state.availableModels).toContain("gpt-5");
    });

    await act(async () => {
      await getControl().onModelSelect("gpt-5", { mode: "manual" });
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(threadMetadata.get("session-1")?.control).toMatchObject({
      model: "gpt-5",
      modelMode: "manual",
      controlDirty: true,
    });
    expect(
      JSON.parse(globalThis.localStorage.getItem("aomi_model_selection")!),
    ).toMatchObject({ mode: "manual", model: "gpt-5" });
    expect(getControl().getPreferredThreadControl()).toMatchObject({
      model: "gpt-5",
      modelMode: "manual",
    });
  });

  it("revalidates a stale stored model after models load", async () => {
    globalThis.localStorage.setItem(
      "aomi_model_selection",
      JSON.stringify({ mode: "manual", model: "old-model" }),
    );
    const threadMetadata = createThreadMetadata();
    const setModel = vi.fn(async () => ({}));
    const { getControl } = renderControlContext(
      {
        getModels: vi.fn(async () => ["gpt-4o-mini", "gpt-5"]),
        setModel,
      },
      threadMetadata,
    );

    await waitFor(() => {
      expect(getControl().state.availableModels).toContain("gpt-4o-mini");
    });

    await waitFor(() => {
      expect(threadMetadata.get("session-1")?.control).toMatchObject({
        model: "gpt-4o-mini",
        modelMode: "auto",
        controlDirty: true,
      });
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(threadMetadata.get("session-1")?.control).toMatchObject({
      model: "gpt-4o-mini",
      modelMode: "auto",
      controlDirty: true,
    });
  });

  it("does not seed fresh threads with a stored manual model before models load", async () => {
    globalThis.localStorage.setItem(
      "aomi_model_selection",
      JSON.stringify({ mode: "manual", model: "old-model" }),
    );

    const models = createDeferred<string[]>();
    const threadMetadata = createThreadMetadata();
    const setModel = vi.fn(async () => ({}));
    const { getControl } = renderControlContext(
      {
        getModels: vi.fn(() => models.promise),
        setModel,
      },
      threadMetadata,
    );

    expect(getControl().getPreferredThreadControl()).toMatchObject({
      model: null,
      modelMode: "auto",
      controlDirty: false,
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(threadMetadata.get("session-1")?.control).toMatchObject({
      model: null,
      modelMode: "auto",
      controlDirty: false,
    });

    await act(async () => {
      models.resolve(["gpt-4o-mini", "gpt-5"]);
      await models.promise;
    });

    await waitFor(() => {
      expect(threadMetadata.get("session-1")?.control).toMatchObject({
        model: "gpt-4o-mini",
        modelMode: "auto",
        controlDirty: true,
      });
    });
  });

  it("can switch back to auto mode after a manual model selection", async () => {
    const threadMetadata = createThreadMetadata();
    const { getControl } = renderControlContext(
      {
        getModels: vi.fn(async () => ["gpt-4o-mini", "gpt-5"]),
      },
      threadMetadata,
    );

    await waitFor(() => {
      expect(getControl().state.availableModels).toContain("gpt-4o-mini");
    });

    await act(async () => {
      await getControl().onModelSelect("gpt-5", { mode: "manual" });
      await getControl().onModelSelect("gpt-4o-mini", { mode: "auto" });
    });

    expect(threadMetadata.get("session-1")?.control).toMatchObject({
      model: "gpt-4o-mini",
      modelMode: "auto",
      controlDirty: true,
    });
    expect(
      JSON.parse(globalThis.localStorage.getItem("aomi_model_selection")!),
    ).toMatchObject({ mode: "auto", model: null });
  });

  it("updates auto threads when a newly available model becomes preferred", async () => {
    const threadMetadata = createThreadMetadata();
    const getModels = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["gpt-4o", "gpt-4o-mini"])
      .mockResolvedValueOnce([
        "claude-opus-4.6",
        "claude-4.5-haiku",
        "gpt-4o",
        "gpt-4o-mini",
      ]);

    const { getControl } = renderControlContext({ getModels }, threadMetadata);

    await waitFor(() => {
      expect(threadMetadata.get("session-1")?.control).toMatchObject({
        model: "gpt-4o-mini",
        modelMode: "auto",
        controlDirty: true,
      });
    });

    await act(async () => {
      await getControl().getAvailableModels();
    });

    await waitFor(() => {
      expect(threadMetadata.get("session-1")?.control).toMatchObject({
        model: "claude-opus-4.6",
        modelMode: "auto",
        controlDirty: true,
      });
    });
  });

  it("keeps model selection dirty when the app changes before send", async () => {
    const threadMetadata = createThreadMetadata();
    const setModel = vi.fn(async () => ({}));
    const { getControl } = renderControlContext(
      {
        getApps: vi.fn(async () => [{ name: "default" }, { name: "docs" }]),
        getModels: vi.fn(async () => ["gpt-4o-mini", "gpt-5"]),
        setModel,
      },
      threadMetadata,
    );

    await waitFor(() => {
      expect(getControl().state.authorizedApps).toContain("docs");
      expect(getControl().state.availableModels).toContain("gpt-5");
    });

    await act(async () => {
      await getControl().onModelSelect("gpt-5", {
        mode: "manual",
      });
    });

    expect(setModel).not.toHaveBeenCalled();

    await act(async () => {
      getControl().onAppSelect("docs");
    });

    expect(threadMetadata.get("session-1")?.control).toMatchObject({
      model: "gpt-5",
      app: "docs",
      controlDirty: true,
    });
  });
});
