// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Aomi } from "./aomi";

describe("headless host", () => {
  it("sends default SDK traffic to the stable API host", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ wallets: [] }));
    await new Aomi({ guest: false, fetch }).account.wallets.list();
    expect(String(fetch.mock.calls[0][0])).toBe(
      "https://api.aomi.dev/v1/account/wallets",
    );
  });
});
