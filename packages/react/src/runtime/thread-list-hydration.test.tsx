import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSession, AomiClient } from "@aomi-labs/client";
import {
  ThreadContextProvider,
  useThreadContext,
} from "../contexts/thread-context";
import { SessionManager } from "./session-manager";
import { useThreadListSync } from "./thread-list-sync";

vi.mock("../contexts/ext-user-context", () => ({
  useUser: () => ({ user: {} }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ThreadContextProvider initialThreadId="new-local">
      {children}
    </ThreadContextProvider>
  );
}

const GUEST = { owner: "guest" };
const SIGNED = { owner: "signed" };

function fixture(all: ReturnType<typeof vi.fn>) {
  const client = { agent: { sessions: { all } } } as unknown as AomiClient;
  return {
    aomiClientRef: { current: client },
    sessionManager: new SessionManager(() => client),
    ensureInitialState: vi.fn(async () => undefined),
    resetConversation: vi.fn(),
    remoteThreadIdsRef: { current: new Set<string>() },
    owner: GUEST,
  };
}

describe("loading the chat list once access arrives", () => {
  it("shows loading, never an empty list, while the first list request is pending", async () => {
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
    expect(
      renders
        .filter((state) => state.access && !state.hasSaved)
        .every((state) => state.loading),
    ).toBe(true);
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
  it("shows loading for a new owner until its own list arrives", async () => {
    let resolve!: (rows: AgentSession[]) => void;
    const all = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<AgentSession[]>((done) => {
            resolve = done;
          }),
      );
    const options = fixture(all);
    const renders: { scope: string; loading: boolean; hasSaved: boolean }[] =
      [];
    const view = renderHook(
      ({ scope }) => {
        const state = useThreadListSync({
          ...options,
          accountSessionAvailable: true,
          owner: scope === "guest" ? GUEST : SIGNED,
        });
        const threads = useThreadContext();
        renders.push({
          scope,
          loading: state.isThreadListLoading,
          hasSaved: threads.allThreadsMetadata.has("saved-chat"),
        });
        return state;
      },
      { initialProps: { scope: "guest" }, wrapper },
    );
    await waitFor(() =>
      expect(view.result.current.isThreadListLoading).toBe(false),
    );
    view.rerender({ scope: "signed" });
    expect(
      renders
        .filter((state) => state.scope === "signed" && !state.hasSaved)
        .every((state) => state.loading),
    ).toBe(true);
    await act(() =>
      resolve([
        { id: "saved-chat", title: "Saved", archived: false, updatedAt: 2 },
      ]),
    );
    await waitFor(() =>
      expect(view.result.current.isThreadListLoading).toBe(false),
    );
    expect(
      renders
        .filter((state) => state.scope === "signed" && !state.hasSaved)
        .every((state) => state.loading),
    ).toBe(true);
  });
});
