import { useEffect, useRef, useSyncExternalStore } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ThreadStore } from "../../../react/src/state/thread-store";
import { buildThreadListAdapter } from "../../../react/src/runtime/threadlist-adapter";
import { AssistantRuntimeBoundary } from "../../../react/src/runtime/assistant-runtime-boundary";
import { ThreadList } from "./thread-list";
import type { AomiClient } from "@aomi-labs/client";

describe("sidebar membership with actual assistant-ui subscribers", () => {
  it("archives and removes the selected row while keeping the shell mounted", async () => {
    const store = new ThreadStore({ initialThreadId: "a" });
    store.updateThreadMetadata("a", { title: "First chat" });
    store.setCurrentThreadId("b");
    store.updateThreadMetadata("b", { title: "Second chat" });
    store.setCurrentThreadId("a");
    const client = {
      agent: { sessions: { update: vi.fn().mockResolvedValue({}) } },
    } as unknown as AomiClient;
    const mounted = vi.fn();
    function Shell() {
      useEffect(() => {
        mounted();
      }, []);
      return <ThreadList />;
    }
    function Frame() {
      const thread = useSyncExternalStore(store.subscribe, store.getSnapshot);
      const restore = useRef(() => {});
      return (
        <AssistantRuntimeBoundary
          adapter={{
            messages: [],
            convertMessage: (message) => message,
            onNew: vi.fn(),
            adapters: {
              threadList: buildThreadListAdapter({
                aomiClientRef: { current: client },
                threadContext: thread,
              }),
            },
          }}
          restoreComposerText={restore}
        >
          <Shell />
        </AssistantRuntimeBoundary>
      );
    }
    render(<Frame />);
    expect(screen.getByText("First chat")).toBeVisible();
    await act(async () => {
      await buildThreadListAdapter({
        aomiClientRef: { current: client },
        threadContext: store.getSnapshot(),
      }).onArchive("a");
    });
    expect(screen.queryByText("First chat")).toBeNull();
    expect(screen.getByText("Second chat")).toBeVisible();
    act(() => {
      store.setThreadMetadata((previous) => {
        const next = new Map(previous);
        next.delete("a");
        return next;
      });
      store.setCurrentThreadId("b");
    });
    expect(screen.getByText("Second chat")).toBeVisible();
    expect(mounted).toHaveBeenCalledOnce();
  });
});
