import { describe, expect, it } from "vitest";
import { ThreadStore, initThreadControl } from "./thread-store";

describe("thread title presentation", () => {
  it("cleans persisted and streamed truncated capability hints for every title consumer", () => {
    const store = new ThreadStore({ initialThreadId: "chat" });
    const title =
      "▦ Cambrian list ur tools <AOMI_UI_CAPABILITY_HINTS> These are capabilit…";
    store.setThreadMetadata(
      new Map([
        [
          "chat",
          {
            title,
            status: "regular",
            control: initThreadControl(),
          },
        ],
      ]),
    );
    expect(store.getThreadMetadata("chat")?.title).toBe(
      "Cambrian list ur tools",
    );
    store.updateThreadMetadata("chat", { title });
    expect(store.getSnapshot().allThreadsMetadata.get("chat")?.title).toBe(
      "Cambrian list ur tools",
    );
    store.updateThreadMetadata("chat", {
      title: "lets deposit 1 usdc to ✦ Aave on ◇ Base",
    });
    expect(store.getThreadMetadata("chat")?.title).toBe(
      "lets deposit 1 usdc to Aave on Base",
    );
    store.updateThreadMetadata("chat", { title: "Cambrian token prices" });
    expect(store.getThreadMetadata("chat")?.title).toBe(
      "Cambrian token prices",
    );
  });

  it("does not notify subscribers when an update changes nothing", () => {
    const store = new ThreadStore({ initialThreadId: "chat" });
    const before = store.getSnapshot();
    let notified = 0;
    store.subscribe(() => notified++);
    store.updateThreadMetadata("chat", {
      title: before.allThreadsMetadata.get("chat")!.title,
    });
    expect(notified).toBe(0);
    expect(store.getSnapshot()).toBe(before);
    store.updateThreadMetadata("chat", { pending: true });
    expect(notified).toBe(1);
  });
});
