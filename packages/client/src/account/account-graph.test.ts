import { describe, expect, it, vi } from "vitest";
import { AomiClient } from "../client";
import { AccountGraphApiError } from "./graph";

describe("shared account graph transport", () => {
  it("uses the same authenticated transport and CSRF intent for profile mutation", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        user: { id: "account" },
        linkedAccounts: [],
        wallets: [],
      }),
    );
    const client = new AomiClient({
      baseUrl: "https://chat.aomi.dev",
      fetch,
      getAccountBearer: async () => "opaque-session",
    });
    await client.account.updateAccount({ displayName: "Aron" });
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://chat.aomi.dev/v1/account");
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer opaque-session",
    );
    expect(new Headers(options.headers).get("X-Aomi-CSRF")).toBe("1");
    expect(JSON.parse(options.body)).toEqual({ displayName: "Aron" });
  });
  it("preserves typed error status and body without consuming the body twice", async () => {
    const client = new AomiClient({
      baseUrl: "https://chat.aomi.dev",
      getAccountBearer: async () => "opaque-session",
      fetch: vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "cannot_unlink_last_login_factor" },
            { status: 409 },
          ),
        ),
    });
    await expect(
      client.account.unlinkIdentity("identity"),
    ).rejects.toMatchObject({
      name: "AccountGraphApiError",
      status: 409,
      body: { error: "cannot_unlink_last_login_factor" },
    } satisfies Partial<AccountGraphApiError>);
  });
});
