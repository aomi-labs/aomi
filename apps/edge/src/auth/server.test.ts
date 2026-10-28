import { describe, expect, it, vi } from "vitest";

import { getBetterAuthSession } from "./server";

describe("request session authority", () => {
  it("never sends an ambient cookie alongside an explicit credential", async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const auth = { api: { getSession } } as unknown as Parameters<typeof getBetterAuthSession>[0];
    const request = new Request("https://portal.example/v1/account", {
      headers: { cookie: "better-auth.session_token=real-user", authorization: "Bearer invalid" },
    });
    expect(await getBetterAuthSession(auth, request)).toBeNull();
    const headers = getSession.mock.calls[0][0].headers as Headers;
    expect(headers.has("cookie")).toBe(false);
    expect(headers.get("authorization")).toBe("Bearer invalid");
    expect(request.headers.has("cookie")).toBe(true);
  });
});
