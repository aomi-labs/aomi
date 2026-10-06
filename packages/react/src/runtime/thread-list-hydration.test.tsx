import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSession, AomiClient } from "@aomi-labs/client";
import {
  ThreadContextProvider,
  useThreadContext,
} from "../../contexts/thread-context";
import { SessionManager } from "../session-manager";
import { useThreadListSync } from "../thread-list-sync";

const control = vi.hoisted(() => ({
  getControlState: () => ({ clientId: "client" }),
}));
vi.mock("../../contexts/control-context", () => ({
  useControl: () => control,
}));
vi.mock("../../contexts/ext-user-context", () => ({
  useUser: () => ({ user: {} }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ThreadContextProvider initialThreadId="new-local">
      {children}
    </ThreadContextProvider>
  );
}

function fixture(all: ReturnType<typeof vi.fn>) {
  const client = { agent: { sessions: { all } } } as unknown as AomiClient;
  return {
    sessions: {
      aomiClientRef: { current: client },
      sessionManager: new SessionManager(() => client),
      closeAllSessions: vi.fn(),
      ensureInitialState: vi.fn(async () => undefined),
      setIsThreadLoading: vi.fn(),
    },
    remoteThreads: {
      remoteThreadIdsRef: { current: new Set<string>() },
      warmPromisesRef: { current: new Map<string, Promise<void>>() },
      warmedThreadIdsRef: { current: new Set<string>() },
      warmThread: vi.fn(async () => undefined),
    },
  };
}

describe("remote list admission after guest bootstrap", () => {
  it("never advertises a ready empty list when access becomes available before its request effect", async () => {
    let resolve!: (rows: AgentSession[]) => void;
    const request = new Promise<AgentSession[]>((done) => {
      resolve = done;
    });
    const all = vi.fn(() => request);
    const options = fixture(all);
    const renders: { access: boolean; loading: boolean; hasSaved: boolean }[] =
      [];
    const view = renderHook(
      ({ access }) => {
        const state = useThreadListSync({
          ...options,
          accountSessionAvailable: access,
        });
        const threads = useThreadContext();
        renders.push({
          access,
          loading: state.isThreadListLoading,
          hasSaved: threads.allThreadsMetadata.has("saved-chat"),
        });
        return { ...state, threads };
      },
      { initialProps: { access: false }, wrapper },
    );
    expect(all).not.toHaveBeenCalled();
    expect(view.result.current.isThreadListLoading).toBe(false);
    view.rerender({ access: true });
    expect(all).toHaveBeenCalledOnce();
    expect(
      renders
        .filter((state) => state.access && !state.hasSaved)
        .every((state) => state.loading),
    ).toBe(true);
    await act(async () =>
      resolve([
        {
          id: "saved-chat",
          title: "Renamed saved chat",
          archived: false,
          updatedAt: 2,
        },
      ]),
    );
    await waitFor(() =>
      expect(view.result.current.isThreadListLoading).toBe(false),
    );
    expect(
      view.result.current.threads.getThreadMetadata("saved-chat")?.title,
    ).toBe("Renamed saved chat");
  });

  it("settles a list failure truthfully instead of keeping its initial spinner", async () => {
    const all = vi.fn().mockRejectedValue(new Error("unavailable"));
    const options = fixture(all);
    const view = renderHook(
      () => useThreadListSync({ ...options, accountSessionAvailable: true }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.threadListError).toBe(true));
    expect(view.result.current.isThreadListLoading).toBe(false);
  });
});
