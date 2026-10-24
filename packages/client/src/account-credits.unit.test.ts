import { describe, expect, it, vi } from "vitest";
import { AomiClient, AccountCreditsTransport } from "./";

describe("credit funding contracts", () => {
  it("creates and resumes one funding event using the canonical routes", async () => {
    const result = { funding_event: { id: "event-1", status: "processing" }, action: { kind: "wait" } };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "POST") {
        expect(request.url).toBe("https://api.test/v1/account/credits/funding-events");
        expect(request.headers.get("idempotency-key")).toBe("fund-1");
        expect(await request.json()).toEqual({ amount_microusd: 5_000_000, method: "card" });
      } else {
        expect(request.url).toBe("https://api.test/v1/account/credits/funding-events/event-1");
      }
      return Response.json(result);
    });
    const client = new AomiClient({ baseUrl: "https://api.test", fetch: fetchImpl as typeof fetch, guest: false });
    await expect(client.account.credits.beginFunding({ amountMicrousd: 5_000_000, method: "card", idempotencyKey: "fund-1" })).resolves.toEqual(result);
    await expect(client.account.credits.fundingEvent("event-1")).resolves.toEqual(result);
  });

  it.each(["account", "builder"])("reads isolated %s balance and ledger", async (kind) => {
    const balance = { balance_microusd: -100, reserved_microusd: 0, available_microusd: -100, debt_microusd: 100 };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      expect(url.pathname.startsWith(`/v1/${kind}/credits`)).toBe(true);
      return Response.json(url.pathname.endsWith("/ledger") ? { entries: [], next_before_id: null } : balance);
    });
    const client = new AomiClient({ baseUrl: "https://api.test", fetch, guest: false });
    const credits = new AccountCreditsTransport(client.requestResponse.bind(client), `/v1/${kind}/credits`);
    await expect(credits.get()).resolves.toEqual({ ...balance, entries: [], next_before_id: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
