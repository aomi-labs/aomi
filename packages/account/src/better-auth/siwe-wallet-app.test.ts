// @vitest-environment node
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

  it.each(["native", "server adapter"])(
    "preserves request credentials and cancellation when rewriting a %s request",
    async (kind) => {
      const controller = new AbortController();
      const proof = { message: "m", signature: "s", walletApp: "Rabby" };
      const source = new Request(
        "https://portal.test/api/auth/siwe/verify?context=a%2Bb",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://portal.test",
            cookie: "session=existing",
            authorization: "Bearer existing",
          },
          body: JSON.stringify(proof),
          signal: controller.signal,
        },
      );
      // srvx uses the native prototype but owns its body and request properties.
      const request: Request =
        kind === "native"
          ? source
          : Object.create(Request.prototype, {
              url: { value: source.url },
              method: { value: source.method },
              headers: { value: source.headers },
              signal: { value: source.signal },
              clone: { value: () => source.clone() },
            });
      const response = new Response("signed in", {
        headers: { "set-cookie": "session=new; HttpOnly; Secure" },
      });
      const handler = vi.fn(async (_request: Request) => response);

      expect(await withSiweWalletApp(request, handler)).toBe(response);
      const forwarded = handler.mock.calls[0]![0];
      expect(forwarded).toBeInstanceOf(Request);
      expect(forwarded.url).toBe(source.url);
      expect(forwarded.method).toBe("POST");
      expect([...forwarded.headers]).toEqual([...source.headers]);
      await expect(forwarded.json()).resolves.toEqual({
        message: "m",
        signature: "s",
      });
      await expect(source.clone().json()).resolves.toEqual(proof);
      controller.abort("client disconnected");
      expect(forwarded.signal.aborted).toBe(true);
      expect(forwarded.signal.reason).toBe("client disconnected");
    },
  );
});
