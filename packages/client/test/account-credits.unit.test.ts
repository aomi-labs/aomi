import { describe, expect, it, vi } from "vitest";

import { AomiClient } from "../src";

const position = {
  period_utc_month: "2026-09-01",
  included: {
    limit_microusd: 50_000_000,
    used_microusd: 5_250_000,
    remaining_microusd: 44_750_000,
  },
  bank: { balance_microusd: 1_500_000, outstanding_debt_microusd: 0 },
  entries: [],
  next_before_id: null,
};

describe("account credits", () => {
  it("uses the account model-key routes and response shape", async () => {
    const key = {
      provider: "openai",
      key_prefix: "sk-test",
      label: null,
      is_active: true,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ keys: [key] }))
      .mockResolvedValueOnce(Response.json({ key }))
      .mockResolvedValueOnce(Response.json({ deleted: true }));
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl,
      guest: false,
    });

    await expect(client.listByokKeys("session-1")).resolves.toEqual([key]);
    await expect(
      client.saveByokKey("session-1", "openai", "sk-test", "work"),
    ).resolves.toEqual(key);
    await expect(client.deleteByokKey("session-1", "openai")).resolves.toBe(
      true,
    );

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.test/api/account/model-keys",
    );
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      "https://api.test/api/account/model-keys",
    );
    expect(String(fetchImpl.mock.calls[2]![0])).toBe(
      "https://api.test/api/account/model-keys/openai",
    );
    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(
      JSON.stringify({
        provider: "openai",
        byok_key: "sk-test",
        label: "work",
      }),
    );
  });

  it("reads a paginated credit position through the account transport", async () => {
    const fetchImpl = vi.fn(async () => Response.json(position));
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });

    await expect(
      client.account.credits.get({ limit: 10, beforeId: 42 }),
    ).resolves.toEqual(position);

    const request = new Request(fetchImpl.mock.calls[0]![0]);
    expect(request.url).toBe(
      "https://api.test/v1/account/credits?limit=10&before_id=42",
    );
  });

  it("submits an exact microusd top-up with a stable retry key", async () => {
    const paymentResponse = btoa(
      JSON.stringify({ transaction: "0xtx", network: "eip155:84532" }),
    );
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.method).toBe("POST");
        expect(request.headers.get("idempotency-key")).toBe("topup-1");
        expect(request.headers.get("x-aomi-csrf")).toBe("1");
        expect(await request.json()).toEqual({ amount_microusd: 1_250_000 });
        return Response.json(position, {
          headers: { "payment-response": paymentResponse },
        });
      },
    );
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });

    await expect(
      client.account.credits.topUp({
        credits: 125,
        idempotencyKey: "topup-1",
      }),
    ).resolves.toEqual({
      ...position,
      receipt: { transaction: "0xtx", network: "eip155:84532" },
    });
  });

  it("rejects imprecise or out-of-range top-ups before requesting", async () => {
    const fetchImpl = vi.fn();
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });

    await expect(
      client.account.credits.topUp({ credits: 0.5, idempotencyKey: "invalid" }),
    ).rejects.toThrow("between 1 and 100,000 credits");
    await expect(
      client.account.credits.topUp({
        amountMicrousd: 10_000.5,
        idempotencyKey: "invalid",
      }),
    ).rejects.toThrow("whole, safe microusd");
    await expect(
      client.account.credits.topUp({
        credits: 100.00001,
        idempotencyKey: "invalid",
      }),
    ).rejects.toThrow("whole, safe microusd");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries an unknown outcome with the same key without creating a new payment", async () => {
    const fetchImpl = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "payment_pending" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(Response.json(position));
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });

    await expect(
      client.account.credits.topUp({
        amountMicrousd: 1_000_000,
        idempotencyKey: "topup-recovery",
      }),
    ).rejects.toThrow("HTTP 503");
    await expect(
      client.account.credits.topUp({
        amountMicrousd: 1_000_000,
        idempotencyKey: "topup-recovery",
        recover: true,
      }),
    ).resolves.toEqual(position);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = new Request(
      fetchImpl.mock.calls[0]![0],
      fetchImpl.mock.calls[0]![1],
    );
    const second = new Request(
      fetchImpl.mock.calls[1]![0],
      fetchImpl.mock.calls[1]![1],
    );
    expect(first.headers.get("idempotency-key")).toBe("topup-recovery");
    expect(second.headers.get("idempotency-key")).toBe("topup-recovery");
  });

  it("does not expose an HTML gateway page in credit errors", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          "<!DOCTYPE html><html><body>502 Bad Gateway</body></html>",
          {
            status: 502,
            headers: { "content-type": "text/html" },
          },
        ),
    );
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });

    const error = await client.account.credits.get().catch((cause) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Failed to fetch account credits: HTTP 502");
    expect(error.message).not.toContain("<!DOCTYPE html>");
  });

  it("retains a structured JSON error detail", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "payment_pending",
            message: "Payment is still confirming",
          },
        },
        { status: 503 },
      ),
    );
    const client = new AomiClient({
      baseUrl: "https://api.test",
      fetch: fetchImpl as typeof fetch,
      guest: false,
    });

    await expect(client.account.credits.get()).rejects.toThrow(
      "HTTP 503\nPayment is still confirming",
    );
  });
});
