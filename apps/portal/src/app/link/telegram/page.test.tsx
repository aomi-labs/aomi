import { describe, expect, it, vi } from "vitest";

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
  it("renders the link host for a well-formed code, signed in or not", async () => {
    expect((await page(code)).props).toEqual({ code });
  });

  it.each([
    ["missing", undefined],
    ["too short", code.slice(1)],
    ["padded", `${code.slice(1)}=`],
    ["repeated", [code, code]],
  ])("shows a %s code as invalid", async (_, value) => {
    expect((await page(value)).props).toEqual({ code: null });
  });

  it("never sends the code on as a referrer", () => {
    expect(metadata.referrer).toBe("no-referrer");
  });
});
