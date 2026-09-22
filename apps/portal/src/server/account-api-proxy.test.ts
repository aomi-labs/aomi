import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mintAgentApiBearer: vi.fn() }));

vi.mock("@aomi-labs/account", () => ({
  mintAgentApiBearer: mocks.mintAgentApiBearer,
}));

import { proxyAccountApi } from "./account-api-proxy";

const principal = {
  canonicalUserId: "canonical-user",
  scopes: ["account:credits:topup", "payments:submit"],
  resource: "https://portal.example/v1/account",
  authSource: "oauth" as const,
  principalClass: "user" as const,
  clientId: "client-1",
};

describe("Account API proxy", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.mintAgentApiBearer
      .mockReset()
      .mockResolvedValue({ bearer: "api-user" });
  });

  it("preserves only Credit Bank payment and retry headers", async () => {
    vi.stubEnv("AOMI_AGENT_API_URL", "http://api-server:8082");
    const upstream = vi.fn().mockResolvedValue(
      Response.json(
        { bank: { balance_microusd: 5_000_000 } },
        {
          headers: {
            "payment-response": "paid",
            "payment-receipt": "receipt",
            "set-cookie": "forbidden=1",
          },
        },
      ),
    );
    const response = await proxyAccountApi(
      new Request("https://portal.example/v1/account/credits/top-up", {
        method: "POST",
        headers: {
          authorization: "Bearer attacker",
          cookie: "secret=1",
          "content-type": "application/json",
          "idempotency-key": "topup-1",
          "payment-signature": "signed-payment",
          "x-aomi-csrf": "1",
          "x-request-id": "request-1",
        },
        body: '{"amount_microusd":5000000}',
      }),
      principal,
      upstream,
    );

    const [url, init] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://api-server:8082/v1/account/credits/top-up",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer api-user");
    expect(headers.get("idempotency-key")).toBe("topup-1");
    expect(headers.get("payment-signature")).toBe("signed-payment");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-aomi-csrf")).toBeNull();
    expect(response.headers.get("payment-response")).toBe("paid");
    expect(response.headers.get("payment-receipt")).toBe("receipt");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    "/v1/account/credits",
    "/v1/account/credits/top-up",
    "/v1/account/statement",
  ])("accepts the exact account path %s", async (path) => {
    vi.stubEnv("AOMI_AGENT_API_URL", "http://api-server:8082");
    const upstream = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const response = await proxyAccountApi(
      new Request(`https://portal.example${path}`),
      principal,
      upstream,
    );
    expect(response.status).toBe(200);
  });

  it("rejects every other account or execution path", async () => {
    const upstream = vi.fn();
    const response = await proxyAccountApi(
      new Request("https://portal.example/v1/account/model-keys"),
      principal,
      upstream,
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
