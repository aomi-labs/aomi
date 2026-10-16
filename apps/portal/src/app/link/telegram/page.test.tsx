import { describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
);
vi.mock("@aomi-labs/account/better-auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./link-telegram-client", () => ({
  LinkTelegramClient: ({ code }: { code: string | null }) => code,
}));

import LinkTelegramPage, { metadata } from "./page";

const code = "Ab0_-".repeat(8) + "xyz";
const page = (value?: string | string[]) =>
  LinkTelegramPage({
    searchParams: Promise.resolve(value === undefined ? {} : { code: value }),
  });

describe("/link/telegram", () => {
  it.each([
    ["signed out", null],
    ["a guest", { user: { id: "guest", isAnonymous: true } }],
  ])("sends %s to login and back to the same link", async (_, session) => {
    getSession.mockResolvedValueOnce(session);
    await expect(page(code)).rejects.toThrow(
      `redirect:/?return_to=%2Flink%2Ftelegram%3Fcode%3D${code}`,
    );
  });

  it("renders the link host for a signed-in account", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "user" } });
    const rendered = await page(code);
    expect(rendered.props).toEqual({ code });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["too short", code.slice(1)],
    ["padded", `${code.slice(1)}=`],
    ["repeated", [code, code]],
  ])(
    "shows a %s code as invalid without a session lookup",
    async (_, value) => {
      getSession.mockClear();
      const rendered = await page(value);
      expect(rendered.props).toEqual({ code: null });
      expect(getSession).not.toHaveBeenCalled();
    },
  );

  it("never sends the code on as a referrer", () => {
    expect(metadata.referrer).toBe("no-referrer");
  });
});
