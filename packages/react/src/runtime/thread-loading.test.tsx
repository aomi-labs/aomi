import { useContext, useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AomiRuntimeProvider } from "./aomi-runtime";
import { ChatBoundaryContext } from "./assistant-runtime-boundary";
import { useAomiDisplayCache, type DisplayCache } from "../query/display-cache";
import { useAomiRuntime, type AomiRuntimeApi } from "../interface";

describe("opening a saved chat", () => {
  it("shows loading from the first render of the switch, not an empty chat", async () => {
    const renders: { threadId: string; loading: boolean }[] = [];
    let runtime!: AomiRuntimeApi;
    function Capture() {
      runtime = useAomiRuntime();
      const chat = useContext(ChatBoundaryContext)!;
      renders.push({
        threadId: chat.threadId,
        loading: Boolean(chat.adapter.isLoading),
      });
      return null;
    }
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/v1/agent/sessions")
        return Response.json({
          sessions: [{ id: "saved", title: "Saved chat", updatedAt: 2 }],
        });
      // The saved chat's history never arrives in this test.
      if (path.includes("saved")) return new Promise<Response>(() => {});
      return Response.json([]);
    });
    render(
      <AomiRuntimeProvider
        backendUrl="https://backend.example"
        clientOptions={{ fetch, guest: false }}
        accountSessionAvailable
        persistThread={false}
        displayPersistence="none"
      >
        <Capture />
      </AomiRuntimeProvider>,
    );
    await waitFor(() =>
      expect(runtime.getThreadMetadata("saved")?.title).toBe("Saved chat"),
    );
    act(() => runtime.selectThread("saved"));
    const opened = renders.filter((entry) => entry.threadId === "saved");
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((entry) => entry.loading)).toBe(true);
  });

  it("loads a cached chat before list revalidation and clears the cache on a merge revision", async () => {
    let runtime!: AomiRuntimeApi;
    let display!: DisplayCache;
    function Capture() {
      runtime = useAomiRuntime();
      const cache = useAomiDisplayCache()!;
      display = cache;
      useEffect(() => {
        cache.client.setQueryData(cache.key("threads"), [
          { id: "saved", title: "Cached chat", archived: false, updatedAt: 2 },
        ]);
      }, [cache]);
      return null;
    }
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path.startsWith("/v1/agent/sessions") || path.includes("saved"))
        return new Promise<Response>(() => {});
      return Response.json([]);
    });
    render(
      <AomiRuntimeProvider
        backendUrl="https://backend.example"
        clientOptions={{ fetch, guest: false }}
        account={{ kind: "user", id: "a" }}
        accountSessionAvailable
        persistThread={false}
        displayPersistence="none"
      >
        <Capture />
      </AomiRuntimeProvider>,
    );
    await waitFor(() =>
      expect(runtime.getThreadMetadata("saved")?.title).toBe("Cached chat"),
    );
    expect(runtime.threadListLoading).toBe(false);
    expect(runtime.threadListRevalidating).toBe(true);
    act(() => runtime.selectThread("saved"));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([input]) =>
            new URL(String(input)).pathname === "/v1/agent/chat/saved",
        ),
      ).toBe(true),
    );
    expect(runtime.threadListRevalidating).toBe(true);
    act(() => runtime.refreshAccountData?.());
    expect(display.client.getQueryData(display.key("threads"))).toBeUndefined();
    expect(runtime.threadListLoading).toBe(true);
  });
});
