import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, AomiClient } from "@aomi-labs/client";
import {
  ThreadContextProvider,
  useThreadContext,
} from "../contexts/thread-context";
import { SessionManager } from "./session-manager";
import {
  DisplayCacheProvider,
  createDisplayQueryClient,
  displayKey,
  displayKeyPrefix,
  useAomiDisplayCache,
  type RuntimeAccount,
} from "../query/display-cache";
import * as persistence from "../query/display-persistence";
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

  it("keeps confirmed thread access during account restoration and clears it on sign-out", async () => {
    const all = vi.fn(async () => [
      { id: "saved-chat", title: "Saved", archived: false },
    ]);
    const options = fixture(all);
    const view = renderHook(
      ({ access, restoringAccount }) =>
        useThreadListSync({
          ...options,
          accountSessionAvailable: access,
          restoringAccount,
        }),
      { initialProps: { access: true, restoringAccount: false }, wrapper },
    );
    await waitFor(() =>
      expect(view.result.current.isThreadListLoading).toBe(false),
    );
    expect(options.remoteThreadIdsRef.current.has("saved-chat")).toBe(true);
    view.rerender({ access: false, restoringAccount: true });
    expect(view.result.current.isThreadListLoading).toBe(true);
    expect(options.resetConversation).not.toHaveBeenCalled();
    view.rerender({ access: true, restoringAccount: false });
    await waitFor(() =>
      expect(view.result.current.isThreadListLoading).toBe(false),
    );
    expect(options.resetConversation).not.toHaveBeenCalled();
    view.rerender({ access: false, restoringAccount: false });
    expect(options.resetConversation).toHaveBeenCalledOnce();
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

describe("saved thread summaries", () => {
  afterEach(() => vi.restoreAllMocks());
  const savedRows = [
    { id: "saved-chat", title: "Old title", archived: false, updatedAt: 2 },
    { id: "deleted-chat", title: "Deleted", archived: false, updatedAt: 1 },
  ];
  function setup(
    account: RuntimeAccount | null | undefined,
    initialRemoteIds: string[] = [],
  ) {
    const scope = {
      backendUrl: "/backend",
      appId: "8",
      account: { kind: "user", id: "a" } as const,
    };
    const original = createDisplayQueryClient();
    original.setQueryData(displayKey(scope, "threads"), savedRows);
    const accountSlot = JSON.stringify([
      "display-v3",
      "/backend",
      "8",
      "account",
    ]);
    const saved = new Map<string, unknown>([
      [
        accountSlot,
        persistence.snapshotDisplayData(
          original,
          displayKeyPrefix(scope, scope.account),
          "a",
        ),
      ],
    ]);
    const persist = persistence.persistDisplayCache;
    vi.spyOn(persistence, "persistDisplayCache").mockImplementation(
      (client, scope, mode, _store, callback) =>
        persist(
          client,
          scope,
          mode,
          {
            get: async (key) => saved.get(key),
            put: async (key, value) => saved.set(key, value),
            delete: async (key) => saved.delete(key),
          },
          callback,
        ),
    );
    const state = { account };
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DisplayCacheProvider
          backendUrl="/backend"
          applicationId={8}
          account={state.account}
          persistence="account"
        >
          <ThreadContextProvider initialThreadId="new-local">
            {children}
          </ThreadContextProvider>
        </DisplayCacheProvider>
      );
    }
    let resolve!: (rows: AgentSession[]) => void;
    const all = vi.fn(
      () =>
        new Promise<AgentSession[]>((done) => {
          resolve = done;
        }),
    );
    const options = fixture(all);
    options.remoteThreadIdsRef.current = new Set(initialRemoteIds);
    const ownerA = {};
    const ownerB = {};
    const view = renderHook(
      () => {
        const threads = useThreadContext();
        const reset = useCallback(() => {
          options.resetConversation();
          threads.resetToDefault();
        }, [threads.resetToDefault]);
        const sync = useThreadListSync({
          ...options,
          owner: state.account?.id === "b" ? ownerB : ownerA,
          accountSessionAvailable: Boolean(state.account),
          resetConversation: reset,
        });
        return { ...sync, threads, cache: useAomiDisplayCache() };
      },
      { wrapper: Wrapper },
    );
    return {
      view,
      state,
      options,
      all,
      resolve: (rows: AgentSession[]) => resolve(rows),
      saved,
      accountSlot,
    };
  }

  it("renders the saved list before fetch settles, and live data replaces renamed and deleted rows", async () => {
    const { view, all, options, resolve } = setup({ kind: "user", id: "a" });
    await waitFor(() =>
      expect(
        view.result.current.threads.getThreadMetadata("saved-chat")?.title,
      ).toBe("Old title"),
    );
    expect(all).toHaveBeenCalledOnce();
    expect(view.result.current.isThreadListLoading).toBe(false);
    expect(view.result.current.isThreadListRevalidating).toBe(true);
    expect(options.remoteThreadIdsRef.current.has("saved-chat")).toBe(true);
    act(() => view.result.current.threads.setCurrentThreadId("saved-chat"));
    await act(() =>
      resolve([
        {
          id: "saved-chat",
          title: "Live title",
          archived: false,
          updatedAt: 3,
        },
      ]),
    );
    await waitFor(() =>
      expect(view.result.current.isThreadListRevalidating).toBe(false),
    );
    expect(
      view.result.current.threads.getThreadMetadata("saved-chat")?.title,
    ).toBe("Live title");
    expect(
      view.result.current.threads.getThreadMetadata("deleted-chat"),
    ).toBeUndefined();
    expect(options.ensureInitialState).toHaveBeenCalledWith("saved-chat");
    expect(
      view.result.current.cache?.client.getQueryData(
        view.result.current.cache.key("threads"),
      ),
    ).toEqual([
      { id: "saved-chat", title: "Live title", archived: false, updatedAt: 3 },
    ]);
  });

  it("keeps chats acknowledged locally before the saved list arrives", async () => {
    const { view, options } = setup({ kind: "user", id: "a" }, ["newer-chat"]);
    await waitFor(() =>
      expect(
        view.result.current.threads.getThreadMetadata("saved-chat"),
      ).toBeDefined(),
    );
    expect(options.remoteThreadIdsRef.current.has("newer-chat")).toBe(true);
  });

  it("accepts an explicit generic rename from the live list over a cached title", async () => {
    const { view, resolve } = setup({ kind: "user", id: "a" });
    await waitFor(() =>
      expect(
        view.result.current.threads.getThreadMetadata("saved-chat")?.title,
      ).toBe("Old title"),
    );
    await act(() =>
      resolve([
        { id: "saved-chat", title: "New Chat", archived: false, updatedAt: 3 },
      ]),
    );
    await waitFor(() =>
      expect(view.result.current.isThreadListRevalidating).toBe(false),
    );
    expect(
      view.result.current.threads.getThreadMetadata("saved-chat")?.title,
    ).toBe("New Chat");
  });

  it("previews an unknown account without using the cache to authorize a fetch and clears on sign-out", async () => {
    const { view, state, all, saved, accountSlot } = setup(undefined);
    await waitFor(() =>
      expect(
        view.result.current.threads.getThreadMetadata("saved-chat")?.title,
      ).toBe("Old title"),
    );
    expect(view.result.current.isThreadListLoading).toBe(false);
    expect(all).not.toHaveBeenCalled();
    state.account = null;
    view.rerender();
    await waitFor(() =>
      expect(
        view.result.current.threads.getThreadMetadata("saved-chat"),
      ).toBeUndefined(),
    );
    await waitFor(() => expect(saved.has(accountSlot)).toBe(false));
    view.unmount();
  });

  it("never shows another account's saved list", async () => {
    const { view } = setup({ kind: "user", id: "b" });
    await act(async () => {});
    expect(
      view.result.current.threads.getThreadMetadata("saved-chat"),
    ).toBeUndefined();
    expect(view.result.current.isThreadListLoading).toBe(true);
  });

  it("drops the preview as soon as a different account is confirmed", async () => {
    const { view, state } = setup({ kind: "user", id: "a" });
    await waitFor(() =>
      expect(
        view.result.current.threads.getThreadMetadata("saved-chat"),
      ).toBeDefined(),
    );
    state.account = { kind: "user", id: "b" };
    view.rerender();
    expect(
      view.result.current.threads.getThreadMetadata("saved-chat"),
    ).toBeUndefined();
    expect(view.result.current.isThreadListLoading).toBe(true);
  });
});
