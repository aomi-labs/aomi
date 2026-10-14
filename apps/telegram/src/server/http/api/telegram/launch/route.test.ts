import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyTelegramInitData = vi.fn();
vi.mock("@aomi-labs/account/telegram", () => ({ verifyTelegramInitData }));

const { POST } = await import("./route");

function request(body: unknown): Request {
  return new Request("https://mini-app.aomi.dev/api/telegram/launch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/telegram/launch", () => {
  beforeEach(() => verifyTelegramInitData.mockReset());

  it("returns the verified launch and never caches it", async () => {
    const launch = { botId: "1", telegramUserId: "7" };
    verifyTelegramInitData.mockReturnValue({ ok: true, launch });

    const response = await POST(request({ botId: "1", initData: "raw" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(launch);
    // The launch proof is per-open; a cached copy would be a replay.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(verifyTelegramInitData).toHaveBeenCalledWith("raw", "1");
  });

  it("maps every verifier reason onto its documented status", async () => {
    const expected = {
      malformed: 400,
      missing_signature: 400,
      missing_user: 400,
      bad_signature: 401,
      expired: 401,
    } as const;

    for (const [reason, status] of Object.entries(expected)) {
      verifyTelegramInitData.mockReturnValue({ ok: false, reason });
      const response = await POST(request({ botId: "1", initData: "raw" }));
      expect(response.status, reason).toBe(status);
      expect(await response.json()).toEqual({ error: reason });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("trims the inputs and rejects non-string fields as malformed", async () => {
    verifyTelegramInitData.mockReturnValue({ ok: false, reason: "malformed" });

    await POST(request({ botId: "  1  ", initData: "  raw  " }));
    expect(verifyTelegramInitData).toHaveBeenCalledWith("raw", "1");

    await POST(request({ botId: 1, initData: null }));
    expect(verifyTelegramInitData).toHaveBeenLastCalledWith("", "");
  });

  it("does not throw on a body that is not JSON", async () => {
    verifyTelegramInitData.mockReturnValue({ ok: false, reason: "malformed" });
    const response = await POST(
      new Request("https://mini-app.aomi.dev/api/telegram/launch", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });
});
