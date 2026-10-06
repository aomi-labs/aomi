import { describe, expect, it, vi } from "vitest";
import { AomiClient } from "@aomi-labs/client";
import { ThreadStore } from "../state/thread-store";
import { buildThreadListAdapter } from "./threadlist-adapter";

describe("thread title persistence", () => {
  it("uses the existing PATCH contract and restores the persisted title on reload", async () => {
    let savedTitle = "Original";
    const fetch = vi.fn(
      async (input: string | URL | Request, options?: RequestInit) => {
        if (options?.method === "PATCH")
          savedTitle = JSON.parse(String(options.body)).title;
        return Response.json({
          id: "saved-thread",
          title: savedTitle,
          archived: false,
          createdAt: 1,
          updatedAt: 2,
        });
      },
    );
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: async () => "test-session-bearer",
    });
    const store = new ThreadStore({ initialThreadId: "saved-thread" });
    store.updateThreadMetadata("saved-thread", { title: savedTitle });
    const adapter = buildThreadListAdapter({
      aomiClientRef: { current: client },
      threadContext: store.getSnapshot(),
    });
    await adapter.onRename("saved-thread", "Revised title");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/agent/sessions/saved-thread"),
      expect.objectContaining({ method: "PATCH" }),
    );
    const reloaded = await client.agent.sessions.get("saved-thread");
    expect(reloaded.title).toBe("Revised title");
    expect(store.getThreadMetadata("saved-thread")?.title).toBe(
      "Revised title",
    );
  });

  it("rejects and rolls back when the title mutation fails", async () => {
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      guest: async () => "test-session-bearer",
      fetch: vi.fn(async () =>
        Response.json({ error: "failed" }, { status: 500 }),
      ),
    });
    const store = new ThreadStore({ initialThreadId: "saved-thread" });
    store.updateThreadMetadata("saved-thread", { title: "Original" });
    const adapter = buildThreadListAdapter({
      aomiClientRef: { current: client },
      threadContext: store.getSnapshot(),
    });
    await expect(
      adapter.onRename("saved-thread", "Failed title"),
    ).rejects.toThrow();
    expect(store.getThreadMetadata("saved-thread")?.title).toBe("Original");
  });

  it("shows one pending conversation before a server title exists", () => {
    const store = new ThreadStore({ initialThreadId: "pending-thread" });
    store.updateThreadMetadata("pending-thread", { title: "", pending: true });
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      fetch: vi.fn(),
    });
    const adapter = buildThreadListAdapter({
      aomiClientRef: { current: client },
      threadContext: store.getSnapshot(),
      isRemoteThread: () => true,
    });
    expect(adapter.threads).toEqual([
      { id: "pending-thread", title: "New Chat", status: "regular" },
    ]);
    store.updateThreadMetadata("pending-thread", {
      title: "A saved conversation",
      pending: false,
    });
    const settled = buildThreadListAdapter({
      aomiClientRef: { current: client },
      threadContext: store.getSnapshot(),
      isRemoteThread: () => true,
    });
    expect(settled.threads).toEqual([
      {
        id: "pending-thread",
        title: "A saved conversation",
        status: "regular",
      },
    ]);
  });
});
