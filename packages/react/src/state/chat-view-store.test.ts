import { describe, expect, it, vi } from "vitest";
import { createChatViewStore } from "./chat-view-store";

describe("bounded per-runtime chat view state", () => {
  it("keeps recent drafts and expansions and evicts the least recently visited chat", () => {
    const store = createChatViewStore(2);
    store.patch("a", {
      draft: "private",
      scroll: { top: 300, atBottom: false },
    });
    store.setFlag("a", "trace", true);
    store.patch("b", { draft: "b" });
    store.touch("a");
    store.patch("c", { draft: "c" });
    expect(store.get("b")).toBeUndefined();
    expect(store.get("a")).toEqual({
      draft: "private",
      scroll: { top: 300, atBottom: false },
      flags: { trace: true },
    });
  });
  it("disposes private state without affecting a second runtime", () => {
    const first = createChatViewStore();
    const second = createChatViewStore();
    first.patch("a", { draft: "first" });
    second.patch("a", { draft: "second" });
    first.clear();
    expect(first.get("a")).toBeUndefined();
    expect(second.get("a")?.draft).toBe("second");
  });
  it("does not notify for an unchanged expansion and removes deleted chats", () => {
    const store = createChatViewStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setFlag("a", "trace", false);
    store.setFlag("a", "trace", false);
    expect(listener).toHaveBeenCalledTimes(1);
    store.delete("a");
    expect(store.get("a")).toBeUndefined();
  });
});
