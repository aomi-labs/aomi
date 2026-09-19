import type { x402Client } from "@x402/core/client";
import { describe, expect, it, vi } from "vitest";

import {
  createEvmPaymentClient,
  wrapFetchWithPaymentChallenges,
} from "../src/payment";
import { wrapFetchWithPublicApiAuthorization } from "../src/client";
import type { AomiOAuthTokenRequest } from "../src/authorization";

const PAID_URL = "https://unit.test/paid";

function paymentRequiredHeader(): string {
  return btoa(
    JSON.stringify({
      x402Version: 2,
      resource: { url: PAID_URL },
      accepts: [],
    }),
  );
}

function challenge(settled = false): Response {
  return new Response(null, {
    status: 402,
    headers: {
      "payment-required": paymentRequiredHeader(),
      ...(settled ? { "payment-response": "settlement-receipt" } : {}),
    },
  });
}

function paymentClient(
  createPaymentPayload = vi.fn(async () => ({
    x402Version: 2,
    payload: { signature: "signed" },
    accepted: {},
  })),
) {
  return {
    client: { createPaymentPayload } as unknown as x402Client,
    createPaymentPayload,
  };
}

describe("wrapFetchWithPaymentChallenges", () => {
  it("reauthorizes signed retries with payments:submit", async () => {
    const scopes: string[][] = [];
    const upstream = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        return request.headers.has("payment-signature")
          ? Response.json({ ok: true })
          : challenge();
      },
    );
    const oauth = vi.fn(async (request: AomiOAuthTokenRequest) => {
      scopes.push([...request.scopes]);
      return {
        accessToken: request.scopes.join("+"),
        expiresAt: Date.now() + 60_000,
        resource: request.resource,
        scopes: request.scopes,
      };
    });
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://unit.test",
      oauth,
    });
    const { client } = paymentClient();

    const response = await wrapFetchWithPaymentChallenges(authorized, client)(
      "https://unit.test/v1/pipeline/tool-calls",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(scopes).toEqual([
      ["pipeline:execute"],
      ["pipeline:execute", "payments:submit"],
    ]);
  });

  it("settles partner and platform challenges without an unsigned replay", async () => {
    const responses = [
      challenge(),
      challenge(true),
      Response.json({ ok: true }),
    ];
    const requests: Array<{
      body: string;
      idempotencyKey: string | null;
      signed: boolean;
    }> = [];
    const rawFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        body: await request.clone().text(),
        idempotencyKey: request.headers.get("idempotency-key"),
        signed: request.headers.has("payment-signature"),
      });
      return responses.shift() ?? new Response(null, { status: 500 });
    };
    const { client, createPaymentPayload } = paymentClient();

    const response = await wrapFetchWithPaymentChallenges(rawFetch, client)(
      PAID_URL,
      {
        method: "POST",
        headers: { "idempotency-key": "pipeline-operation-1" },
        body: "original request",
      },
    );

    expect(response.status).toBe(200);
    expect(requests).toEqual([
      {
        body: "original request",
        idempotencyKey: "pipeline-operation-1",
        signed: false,
      },
      {
        body: "original request",
        idempotencyKey: "pipeline-operation-1",
        signed: true,
      },
      {
        body: "original request",
        idempotencyKey: "pipeline-operation-1",
        signed: true,
      },
    ]);
    expect(createPaymentPayload).toHaveBeenCalledTimes(2);
  });

  it("returns a rejected settlement without attempting another payment", async () => {
    const responses = [challenge(), challenge()];
    const rawFetch = vi.fn(
      async () => responses.shift() ?? new Response(null, { status: 500 }),
    );
    const { client, createPaymentPayload } = paymentClient();

    const response = await wrapFetchWithPaymentChallenges(
      rawFetch,
      client,
    )(PAID_URL);

    expect(response.status).toBe(402);
    expect(rawFetch).toHaveBeenCalledTimes(2);
    expect(createPaymentPayload).toHaveBeenCalledTimes(1);
  });

  it("returns a facilitator failure without retrying", async () => {
    const responses = [challenge(), new Response(null, { status: 500 })];
    const rawFetch = vi.fn(
      async () => responses.shift() ?? new Response(null, { status: 500 }),
    );
    const { client, createPaymentPayload } = paymentClient();

    const response = await wrapFetchWithPaymentChallenges(
      rawFetch,
      client,
    )(PAID_URL);

    expect(response.status).toBe(500);
    expect(rawFetch).toHaveBeenCalledTimes(2);
    expect(createPaymentPayload).toHaveBeenCalledTimes(1);
  });

  it("propagates a malformed challenge", async () => {
    const rawFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 402,
          headers: { "payment-required": "not-base64" },
        }),
    );
    const { client } = paymentClient();

    await expect(
      wrapFetchWithPaymentChallenges(rawFetch, client)(PAID_URL),
    ).rejects.toThrow("Failed to parse payment requirements");
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates wallet rejection without sending a signed retry", async () => {
    const rawFetch = vi.fn(async () => challenge());
    const createPaymentPayload = vi.fn(async () => {
      throw new Error("User rejected payment");
    });
    const { client } = paymentClient(createPaymentPayload);

    await expect(
      wrapFetchWithPaymentChallenges(rawFetch, client)(PAID_URL),
    ).rejects.toThrow("User rejected payment");
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the final response after four sequential settled challenges", async () => {
    let calls = 0;
    const rawFetch = vi.fn(async () => {
      calls += 1;
      return challenge(calls > 1);
    });
    const { client, createPaymentPayload } = paymentClient();

    const response = await wrapFetchWithPaymentChallenges(
      rawFetch,
      client,
    )(PAID_URL);

    expect(response.status).toBe(402);
    expect(rawFetch).toHaveBeenCalledTimes(5);
    expect(createPaymentPayload).toHaveBeenCalledTimes(4);
  });
});

describe("createEvmPaymentClient", () => {
  it("adapts the configured Aomi wallet to x402 signing and chain switching", async () => {
    const signTypedData = vi.fn(async () => `0x${"1".repeat(130)}`);
    const switchChain = vi.fn(async () => undefined);
    const client = createEvmPaymentClient({
      address: "0x9cb9ec43b1Dcbe0ea37bfA9A99f2c9AAe2eBf2EB",
      chainId: 1,
      signTypedData,
      switchChain,
    });

    await client!.createPaymentPayload({
      x402Version: 2,
      resource: { url: PAID_URL },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "1000",
          payTo: "0x9cb9ec43b1Dcbe0ea37bfA9A99f2c9AAe2eBf2EB",
          maxTimeoutSeconds: 60,
          extra: { name: "USDC", version: "2" },
        },
      ],
    });

    expect(switchChain).toHaveBeenCalledWith(84532);
    expect(signTypedData).toHaveBeenCalledWith({
      typedData: expect.objectContaining({
        primaryType: "TransferWithAuthorization",
      }),
    });
  });
});
