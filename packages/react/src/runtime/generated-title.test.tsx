import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AomiClient, SessionSnapshot } from "@aomi-labs/client";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { ThreadContextProvider } from "../contexts/thread-context";
import { useRuntimeOrchestrator } from "./orchestrator";

const fake = vi.hoisted(() => ({
  snapshot: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  send: vi.fn(),
  hydrate: vi.fn(),
}));
vi.mock("@aomi-labs/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aomi-labs/client")>();
  return {
    ...actual,
    Session: class {
      syncRuntimeOptions() {}
      sendAsync = fake.send;
      fetchCurrentState = fake.hydrate;
      subscribe = (listener: () => void) => {
        fake.listeners.add(listener);
        return () => fake.listeners.delete(listener);
      };
      getSnapshot = () => fake.snapshot as SessionSnapshot;
      close() {}
    },
  };
});
function update(patch: Record<string, unknown>) {
  act(() => {
    fake.snapshot = { ...fake.snapshot, ...patch };
    fake.listeners.forEach((listener) => listener());
  });
}
function renderOrchestrator(options: Record<string, unknown> = {}) {
  fake.listeners.clear();
  fake.send.mockReset().mockResolvedValue(undefined);
  fake.hydrate.mockReset().mockResolvedValue(undefined);
  fake.snapshot = {
    events: [],
    commits: [],
    liveMessages: [],
    terminalTurns: [],
    isSubmitting: false,
  };
  const get = vi.fn().mockResolvedValue({ title: "Generated title" });
  const client = { agent: { sessions: { get } } } as unknown as AomiClient;
  const view = renderHook(
    () =>
      useRuntimeOrchestrator(client, {
        getUserState: () => ({}),
        getTarget: () => ({ mode: "auto" }),
        ...options,
      }),
    {
      wrapper: ({ children }) => (
        <ThreadContextProvider initialThreadId="a">
          {children}
        </ThreadContextProvider>
      ),
    },
  );
  return { ...view, get };
}
describe("generated chat title", () => {
  it("refreshes at terminal completion once, never at start or on each terminal event", async () => {
    const { get } = renderOrchestrator();
    update({ turnId: "turn", turnState: "processing" });
    expect(get).not.toHaveBeenCalled();
    update({ turnState: "complete" });
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    update({ terminalTurns: [{ turnId: "turn", state: "complete" }] });
    expect(get).toHaveBeenCalledOnce();
  });
  it("uses streamed titles without an extra request", () => {
    const { get } = renderOrchestrator();
    update({ turnId: "turn", turnState: "processing" });
    update({ turnState: "complete", title: "Streamed title" });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("work from a closed account", () => {
  it("never lets an old history load count for the chat that replaced it", async () => {
    const view = renderOrchestrator();
    let oldReady!: () => void;
    let nextReady!: () => void;
    fake.hydrate
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            oldReady = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            nextReady = resolve;
          }),
      );
    const old = view.result.current.ensureInitialState("a");
    act(() => view.result.current.closeAllSessions());
    const next = view.result.current.ensureInitialState("a");
    oldReady();
    await old;
    expect(view.result.current.ensureInitialState("a")).toBe(next);
    nextReady();
    await next;
    expect(fake.hydrate).toHaveBeenCalledTimes(2);
  });
});

describe("history of a chat sent from this tab", () => {
  it("revisits a sent chat without reloading its history", async () => {
    const view = renderOrchestrator();
    await act(() => view.result.current.sendMessage("local turn", "a"));
    await act(() => view.result.current.ensureInitialState("a"));
    expect(fake.hydrate).not.toHaveBeenCalled();
  });
});

describe("credits after a live reply", () => {
  it("refreshes credits once when a sent turn completes, never for loaded history or the turn shown while sending", async () => {
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    const balance = vi.fn().mockResolvedValueOnce(100).mockResolvedValue(90);
    const observer = new QueryObserver(cache, {
      queryKey: ["credits"],
      queryFn: balance,
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    const ended = vi.fn(() => {
      void cache.invalidateQueries({ queryKey: ["credits"], exact: true });
    });
    const view = renderOrchestrator({ onTurnEnded: ended });
    update({ turnId: "history", turnState: "complete", title: "Saved title" });
    expect(ended).not.toHaveBeenCalled();
    fake.send.mockImplementation(async () => {
      update({ isSubmitting: true });
      expect(ended).not.toHaveBeenCalled();
      update({ turnId: "live", turnState: "processing", isSubmitting: false });
    });
    await act(() => view.result.current.sendMessage("fresh reply", "a"));
    update({ turnState: "complete" });
    await waitFor(() => expect(observer.getCurrentResult().data).toBe(90));
    update({ terminalTurns: [{ turnId: "live", state: "complete" }] });
    expect(ended).toHaveBeenCalledOnce();
    expect(balance).toHaveBeenCalledTimes(2);
    expect(view.get).not.toHaveBeenCalled();
    unsubscribe();
    cache.clear();
  });
  it.each(["failed", "interrupted"])(
    "refreshes credits after a started reply is %s",
    async (state) => {
      const cache = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
      });
      const balance = vi.fn().mockResolvedValueOnce(100).mockResolvedValue(95);
      const observer = new QueryObserver(cache, {
        queryKey: ["credits"],
        queryFn: balance,
      });
      const unsubscribe = observer.subscribe(() => {});
      await observer.refetch();
      const ended = vi.fn(() => {
        void cache.invalidateQueries({ queryKey: ["credits"], exact: true });
      });
      const view = renderOrchestrator({ onTurnEnded: ended });
      fake.send.mockImplementation(async () => {
        update({ turnId: "partial", turnState: "processing", title: "Saved" });
      });
      await act(() => view.result.current.sendMessage("partial reply", "a"));
      update({ turnState: state });
      await waitFor(() => expect(observer.getCurrentResult().data).toBe(95));
      update({ terminalTurns: [{ turnId: "partial", state }] });
      expect(balance).toHaveBeenCalledTimes(2);
      expect(ended).toHaveBeenCalledOnce();
      unsubscribe();
      cache.clear();
    },
  );
  it("does not refresh credits after a rejected send or a later history load", async () => {
    const ended = vi.fn();
    const view = renderOrchestrator({ onTurnEnded: ended });
    fake.send.mockRejectedValue(new Error("Start rejected"));
    await expect(
      view.result.current.sendMessage("rejected", "a"),
    ).rejects.toThrow("Start rejected");
    update({ turnId: "history", turnState: "complete", title: "Saved" });
    expect(ended).not.toHaveBeenCalled();
  });
  it("still reports the running turn when a second send is rejected", async () => {
    const ended = vi.fn();
    const view = renderOrchestrator({ onTurnEnded: ended });
    fake.send
      .mockImplementationOnce(async () => {
        update({ turnId: "admitted", turnState: "processing", title: "Saved" });
      })
      .mockRejectedValueOnce(new Error("Wait for the current generation"));
    await act(() => view.result.current.sendMessage("first message", "a"));
    await expect(
      view.result.current.sendMessage("rejected message", "a"),
    ).rejects.toThrow("Wait for the current generation");
    update({ turnState: "complete" });
    expect(ended).toHaveBeenCalledOnce();
  });
  it("reports nothing for a turn that ends after its chat was closed", async () => {
    const ended = vi.fn();
    const view = renderOrchestrator({ onTurnEnded: ended });
    fake.send.mockImplementation(async () => {
      update({ turnId: "old", turnState: "processing" });
    });
    await act(() => view.result.current.sendMessage("old account", "a"));
    act(() => view.result.current.closeAllSessions());
    update({ turnState: "complete" });
    expect(ended).not.toHaveBeenCalled();
  });
});
