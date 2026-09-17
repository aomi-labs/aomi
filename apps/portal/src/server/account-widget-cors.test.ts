import { describe, it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ resolve: vi.fn(), forward: vi.fn() }));
vi.mock("@portal/server/account-api-proxy", () => ({
  proxyAccountApi: state.forward,
}));
vi.mock("@portal/server/oauth/principal", () => ({
  resolveApiPrincipal: state.resolve,
  ApiPrincipalError: class extends Error {},
}));
vi.mock("@portal/server/oauth/resources", () => ({
  ACCOUNT_SCOPES: [
    "account:credits:read",
    "account:usage:read",
    "account:credits:topup",
  ],
  aomiOAuthResources: () => ({ accountRest: "https://api.example/v1/account" }),
}));
import * as credits from "../app/v1/account/credits/route";
import * as statement from "../app/v1/account/statement/route";
import * as topUp from "../app/v1/account/credits/top-up/route";
const origin = "https://embed.example";
beforeEach(() => {
  state.resolve.mockReset().mockResolvedValue({ canonicalUserId: "user-a" });
  state.forward
    .mockReset()
    .mockImplementation(async () => Response.json({ entries: [] }));
});
describe("widget account route CORS", () => {
  for (const [path, method, route] of [
    ["credits", "GET", credits],
    ["statement", "GET", statement],
    ["credits/top-up", "POST", topUp],
  ] as const) {
    it(`preflights ${path} and exposes authenticated responses`, async () => {
      const url = `https://portal.example/v1/account/${path}`;
      const options = route.OPTIONS(
        new Request(url, { method: "OPTIONS", headers: { Origin: origin } }),
      );
      expect(options.status).toBe(204);
      expect(options.headers.get("Access-Control-Allow-Headers")).toContain("X-Aomi-CSRF");
      expect(options.headers.get("Access-Control-Allow-Headers")).toContain(
        "Authorization",
      );
      const handler =
        method === "GET"
          ? (route as typeof credits).GET
          : (route as typeof topUp).POST;
      const response = await handler(
        new Request(url, { method, headers: { Origin: origin } }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(
        response.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
      expect(state.resolve).toHaveBeenCalledOnce();
    });
  }
  it("keeps authentication failures readable without skipping verification", async () => {
    state.resolve.mockRejectedValue(new Error("invalid_token"));
    const response = await statement.GET(
      new Request("https://portal.example/v1/account/statement", {
        headers: { Origin: origin },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(state.forward).not.toHaveBeenCalled();
  });
});
