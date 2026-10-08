// @vitest-environment node
import { createAuthClient } from "better-auth/client";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { aomiSiwsClient, type SiwsNonceResponse } from "./siws-client";

describe("SIWS browser transport", () => {
  it("keeps BetterAuth callback, header and throw options outside the request body", async () => {
    const requests: Request[] = [];
    const onSuccess = vi.fn();
    const nonce = {
      nonce: "proof-nonce",
      domain: "example.test",
      uri: "https://example.test",
    };
    const client = createAuthClient({
      baseURL: "https://example.test/api/auth",
      plugins: [aomiSiwsClient()],
      fetchOptions: {
        customFetchImpl: async (input, init) => {
          requests.push(new Request(input, init));
          return Response.json(nonce);
        },
      },
    });
    const response = await client.siws.nonce(
      {
        walletAddress: "wallet",
        fetchOptions: {
          throw: true,
          headers: { "x-proof": "embedded" },
          onSuccess,
        },
      },
      { throw: true, headers: { "x-proof": "second-argument" } },
    );
    expectTypeOf(response).toEqualTypeOf<SiwsNonceResponse>();
    expect(response).toEqual(nonce);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(requests[0]?.url).toBe("https://example.test/api/auth/siws/nonce");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("x-proof")).toBe("embedded");
    expect(await requests[0]?.json()).toEqual({ walletAddress: "wallet" });
  });

  it("forwards verify errors to the caller's callback", async () => {
    const onError = vi.fn();
    const client = createAuthClient({
      baseURL: "https://example.test/api/auth",
      plugins: [aomiSiwsClient()],
      fetchOptions: {
        customFetchImpl: async () =>
          Response.json(
            { code: "INVALID_PROOF", message: "Invalid signature" },
            { status: 401 },
          ),
      },
    });
    const result = await client.siws.verify(
      { walletAddress: "wallet", message: "proof", signature: "invalid" },
      { onError },
    );
    expect(result.error?.code).toBe("INVALID_PROOF");
    expect(onError).toHaveBeenCalledOnce();
  });
});
