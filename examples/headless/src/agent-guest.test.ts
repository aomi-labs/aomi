import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("bootstraps a guest and prints its reply without real network requests", async () => {
  vi.stubEnv("AOMI_BASE_URL", "https://chat.example");
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://chat.example");
    if (url.pathname === "/api/auth/guest")
      return Response.json({ token: "guest-test" });
    expect(url.pathname).toBe("/v1/agent/chat");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer guest-test",
    );
    const { sessionId } = JSON.parse(String(init?.body));
    const meta = { turn_id: "turn-1", occurred_at: Date.now() };
    return Response.json({
      session_id: sessionId,
      cursor: "c",
      has_more: false,
      started_turn_id: "turn-1",
      events: [
        {
          ...meta,
          event_id: "e1",
          sequence: 1,
          type: "message",
          sender: "agent",
          content: "Hello from Aomi.",
        },
        {
          ...meta,
          event_id: "e2",
          sequence: 2,
          type: "turn_state_changed",
          state: "complete",
        },
      ],
      commits: [],
    });
  });
  vi.stubGlobal("fetch", fetch);
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  await import("./agent-guest");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenCalledWith("Hello from Aomi.");
});
