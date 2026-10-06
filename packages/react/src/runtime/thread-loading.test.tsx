import { useContext } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AomiRuntimeProvider } from "./aomi-runtime";
import { ChatBoundaryContext } from "./assistant-runtime-boundary";
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
});
