import { beforeEach, describe, expect, it, vi } from "vitest";
const getSession = vi.hoisted(() => vi.fn());
vi.mock("@aomi-labs/account/better-auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("@aomi-labs/account/account", () => ({
  getAccountResponseForBetterAuthSession: vi.fn(),
  getOrCreateAomiUserForBetterAuthSession: vi.fn(),
}));
import { getBetterAuthSession } from "./session";
describe("request session authority", () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue(null);
  });
  it("never sends an ambient cookie alongside an explicit credential", async () => {
    const request = new Request("https://portal.example/v1/account", {
      headers: {
        cookie: "better-auth.session_token=real-user",
        authorization: "Bearer invalid",
      },
    });
    expect(await getBetterAuthSession(request)).toBeNull();
    const headers = getSession.mock.calls[0][0].headers as Headers;
    expect(headers.has("cookie")).toBe(false);
    expect(headers.get("authorization")).toBe("Bearer invalid");
    expect(request.headers.has("cookie")).toBe(true);
  });
  it("coalesces one request's session lookup without sharing it with the next request", async () => {
    const request = new Request("https://portal.example/v1/account", {
      headers: { cookie: "session=one" },
    });
    await Promise.all([
      getBetterAuthSession(request),
      getBetterAuthSession(request),
    ]);
    expect(getSession).toHaveBeenCalledTimes(1);
    await getBetterAuthSession(new Request(request));
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
