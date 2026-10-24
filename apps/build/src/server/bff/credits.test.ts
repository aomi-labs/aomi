// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), mint: vi.fn(), forward: vi.fn() }));
vi.mock("./auth", () => ({ authorize: mocks.authorize }));
vi.mock("@aomi-labs/account", () => ({ mintDelegatedBearer: mocks.mint }));
vi.mock("@aomi-labs/account/forward", () => ({ forward: mocks.forward, AGENT_API_HEADERS: {} }));
vi.mock("@/server/env", () => ({ backendUrl: () => "https://api.example" }));
import { credits } from "./credits";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ session: { githubUserId: 42 } });
  mocks.mint.mockResolvedValue({ bearer: "delegated-test" });
  mocks.forward.mockResolvedValue(Response.json({}));
});
it("delegates only the authenticated GitHub builder and exact operation scope", async () => {
  const request = new Request("https://build.example/v1/builder/credits/funding-events", {
    method: "POST", headers: { Origin: "https://build.example", "Idempotency-Key": "test", "Payment-Signature": "test-proof" },
    body: JSON.stringify({ amount_microusd: 5000000, method: "wallet" }),
  });
  await credits(request);
  expect(mocks.authorize).toHaveBeenCalledWith(request, { write: true });
  expect(mocks.mint).toHaveBeenCalledWith("42", "aomi-payment", expect.objectContaining({
    resource: "https://build.example/v1/builder", scope: "builder:credits:fund payments:submit",
  }));
  expect(mocks.forward.mock.calls[0][0].url.href).toBe("https://api.example/v1/builder/credits/funding-events");
});
it("fails closed on session or CSRF rejection", async () => {
  mocks.authorize.mockResolvedValue({ response: new Response(null, { status: 403 }) });
  expect((await credits(new Request("https://build.example/v1/builder/credits/funding-events", { method: "POST" }))).status).toBe(403);
  expect(mocks.mint).not.toHaveBeenCalled();
  expect(mocks.forward).not.toHaveBeenCalled();
});
it.each(["top-up", "purchases", "funding-events/id/other"])("rejects removed or private path %s", async suffix => {
  expect((await credits(new Request(`https://build.example/v1/builder/credits/${suffix}`, { method: "POST" }))).status).toBe(404);
  expect(mocks.forward).not.toHaveBeenCalled();
});
