import { describe, expect, it, vi } from "vitest";
import { AomiClient, AccountCreditsTransport } from "./";

describe("credit funding contracts", () => {
  it("creates and resumes one funding event using the canonical routes", async () => {
    const result = {
      funding_event: { id: "event-1", status: "processing" },
      action: { kind: "wait" },
    };
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === "POST") {
          expect(request.url).toBe(
            "https://api.test/v1/account/credits/funding-events",
          );
          expect(request.headers.get("idempotency-key")).toBe("fund-1");
          expect(await request.json()).toEqual({
            amount_microusd: 5_000_000,
            method: "card",
          });
        } else {
          expect(request.url).toBe(
            "https://api.test/v1/account/credits/funding-events/event-1",
          );
        }
        return Response.json(result);
      },
    );
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });
    await expect(
      client.account.credits.beginFunding({
        amountMicrousd: 5_000_000,
        method: "card",
        idempotencyKey: "fund-1",
      }),
    ).resolves.toEqual(result);
    await expect(
      client.account.credits.fundingEvent("event-1"),
    ).resolves.toEqual(result);
  });

  it("selects the Stripe test environment explicitly and exposes its method", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === "GET")
          return Response.json({
            card: {
              public_key: "pk_live_fixture",
              environment: "production",
              min_microusd: 5_000_000,
              max_microusd: 1_000_000_000,
            },
            test_card: {
              public_key: "pk_test_fixture",
              environment: "test",
              min_microusd: 5_000_000,
              max_microusd: 1_000_000_000,
            },
            wallet: {
              min_microusd: 1_000_000,
              max_microusd: 1_000_000_000,
              networks: [],
            },
          });
        return Response.json({
          funding_event: { id: "event-test" },
          action: { kind: "wait" },
        });
      },
    );
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });

    const methods = await client.account.credits.methods();
    expect(methods.test_card?.public_key).toBe("pk_test_fixture");
    await client.account.credits.beginFunding({
      amountMicrousd: 5_000_000,
      method: "card",
      environment: "test",
      idempotencyKey: "fund-test-1",
    });

    expect(await requests[1].json()).toEqual({
      amount_microusd: 5_000_000,
      method: "card",
      environment: "test",
    });
  });

  it.each(["account", "builder"])(
    "reads isolated %s balance and ledger",
    async (kind) => {
      const balance = {
        balance_microusd: -100,
        reserved_microusd: 0,
        available_microusd: -100,
        debt_microusd: 100,
      };
      const fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          expect(url.pathname.startsWith(`/v1/${kind}/credits`)).toBe(true);
          return Response.json(
            url.pathname.endsWith("/ledger")
              ? { entries: [], next_before_id: null }
              : balance,
          );
        },
      );
      const client = new AomiClient({
        baseUrl: "https://api.test",
        fetch,
        guest: false,
      });
      const credits = new AccountCreditsTransport(
        client.requestResponse.bind(client),
        `/v1/${kind}/credits`,
      );
      await expect(credits.get()).resolves.toEqual(balance);
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(credits.ledger()).resolves.toEqual({
        entries: [],
        next_before_id: null,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});
