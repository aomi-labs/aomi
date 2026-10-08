import { describe, expect, it, vi } from "vitest";
import { exchangeCliSession } from "./auth";
describe("separate CLI sessions", () => {
  const auth = {
    sessionToken: "browser-session",
    expiresAt: 2_000_000_000_000,
    walletFamily: "evm" as const,
    walletAddress: "0xabc",
  };
  it("exchanges the token and keeps verified wallet metadata", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        sessionToken: "cli-session",
        expiresAt: "2026-10-07T00:00:00Z",
      }),
    );
    const result = await exchangeCliSession(
      "https://chat.aomi.dev",
      auth,
      fetch,
    );
    expect(result).toEqual({
      ...auth,
      sessionToken: "cli-session",
      expiresAt: Date.parse("2026-10-07T00:00:00Z"),
    });
    expect(
      new Headers(fetch.mock.calls[0][1].headers).get("Authorization"),
    ).toBe("Bearer browser-session");
  });
  it("never falls back to the longer browser session on failed exchange", async () => {
    await expect(
      exchangeCliSession(
        "https://chat.aomi.dev",
        auth,
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ error: "unavailable" }, { status: 503 }),
          ),
      ),
    ).rejects.toThrow("CLI session exchange failed: HTTP 503");
  });
});
