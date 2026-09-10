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
      "▦ Cambrian list ur tools",
    );
    store.updateThreadMetadata("chat", { title });
    expect(store.getSnapshot().allThreadsMetadata.get("chat")?.title).toBe(
      "▦ Cambrian list ur tools",
    );
    store.updateThreadMetadata("chat", { title: "Cambrian token prices" });
    expect(store.getThreadMetadata("chat")?.title).toBe(
      "Cambrian token prices",
    );
  });
});
