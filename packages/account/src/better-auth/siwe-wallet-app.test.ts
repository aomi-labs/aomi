import { describe, expect, it, vi } from "vitest";
import { withSiweWalletApp } from "./siwe-wallet-app";

const verify = (body: unknown) =>
  new Request("https://portal.test/api/auth/siwe/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("withSiweWalletApp", () => {
  it("hands Better Auth the strict SIWE body without the wallet app", async () => {
    const handler = vi.fn(async (request: Request) =>
      Response.json(await request.json()),
    );
    const response = await withSiweWalletApp(
      verify({ message: "m", signature: "s", walletApp: "Rabby" }),
      handler,
    );
    expect(await response.json()).toEqual({ message: "m", signature: "s" });
  });

  it("leaves other wallet auth requests alone", async () => {
    const request = new Request("https://portal.test/api/auth/siwe/nonce", {
      method: "POST",
      body: "{}",
    });
    const handler = vi.fn(async () => new Response(null));
    await withSiweWalletApp(request, handler);
    expect(handler).toHaveBeenCalledWith(request);
  });
});
