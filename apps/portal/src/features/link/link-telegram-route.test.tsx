import { describe, expect, it, vi } from "vitest";

vi.mock("./link-telegram-client", () => ({ LinkTelegramClient: () => null }));

import { Route } from "@/routes/link.telegram";

const code = "Ab0_-".repeat(8) + "xyz";
const search = (value?: string | string[]) =>
  Route.options.validateSearch!(value === undefined ? {} : { code: value });

describe("/link/telegram", () => {
  it("passes a well-formed code to the link host, signed in or not", () => {
    expect(search(code)).toEqual({ code });
  });

  it.each([
    ["missing", undefined],
    ["too short", code.slice(1)],
    ["padded", `${code.slice(1)}=`],
    ["repeated", [code, code]],
  ])("shows a %s code as invalid", (_, value) => {
    expect(search(value)).toEqual({ code: null });
  });

  it("never sends the code on as a referrer", async () => {
    const head = await Route.options.head!({} as never);
    expect(head?.meta).toContainEqual({
      name: "referrer",
      content: "no-referrer",
    });
  });
});
