// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { establishTelegramLaunch } from "./telegram";

function launchWindow(url: string, initData = "") {
  const ready = vi.fn();
  const expand = vi.fn();
  vi.stubGlobal("window", {
    location: new URL(url),
    Telegram: {
      WebApp: {
        initData,
        initDataUnsafe: { user: { id: "unverified-user" } },
        ready,
        expand,
      },
    },
  });
  return { ready, expand };
}

afterEach(() => vi.unstubAllGlobals());

describe("Telegram launch in the hydrated wallet", () => {
  it("initializes Telegram and verifies raw launch data with the native endpoint", async () => {
    const app = launchWindow("https://mini-app.aomi.dev/?bot_id=0009007199254740993&session_id=telegram%3Adm%3A7%2B8", "signed raw launch");
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      expect(app.ready).toHaveBeenCalledOnce();
      expect(app.expand).toHaveBeenCalledOnce();
      expect(url).toBe("/api/telegram/launch");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(options.body))).toEqual({ botId: "0009007199254740993", initData: "signed raw launch" });
      return Response.json({ botId: "0009007199254740993", telegramUserId: "verified-user", authDate: 1_800_000_000 });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await establishTelegramLaunch()).toEqual({
      authDate: 1_800_000_000,
      inTelegram: true,
      proof: { botId: "0009007199254740993", initData: "signed raw launch", telegramUserId: "verified-user" },
      sessionId: "telegram:dm:7+8",
      verified: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["localhost", "127.0.0.1"])("permits only an unverified layout preview on %s", async (host) => {
    launchWindow(`http://${host}/?session_id=telegram%3Adm%3A7`);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await establishTelegramLaunch()).toEqual({
      authDate: 0,
      inTelegram: false,
      proof: null,
      sessionId: "telegram:dm:7",
      verified: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an outside-Telegram deployed launch without contacting authentication", async () => {
    launchWindow("https://mini-app.aomi.dev/?bot_id=001");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(establishTelegramLaunch()).rejects.toThrow("open_from_telegram");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a signed launch without the bot identifier", async () => {
    launchWindow("https://mini-app.aomi.dev/?session_id=telegram%3Adm%3A7", "signed raw launch");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(establishTelegramLaunch()).rejects.toThrow("missing_bot_id");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["bad_signature", "expired"])("preserves the verifier's %s rejection", async (error) => {
    launchWindow("https://mini-app.aomi.dev/?bot_id=001", "signed raw launch");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error }, { status: 401 })));
    await expect(establishTelegramLaunch()).rejects.toThrow(error);
  });
});
