import { describe, expect, it, vi } from "vitest";
import { AomiClient } from "../src/client";
import {
  ensureSvmWalletBound,
  ensureSvmWalletBoundVia,
  isUnboundWalletError,
} from "../src/authorization";

const WALLET = "BindTestWallet1111111111111111111111111111";
const MESSAGE = "Aomi Authorization v1\nbind test payload";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function challengeBody() {
  return {
    permit: {
      account: "acct-1",
      chain_type: "svm",
      wallet: WALLET,
      mode: "bind",
      version: 0,
      expiry: 4102444800,
    },
    message_base64: Buffer.from(MESSAGE).toString("base64"),
  };
}

describe("Solana wallet authorization", () => {
  it("signs the exact challenge bytes and commits the base64 signature", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ path, body });
        return path.endsWith("/challenge")
          ? jsonResponse(200, challengeBody())
          : jsonResponse(200, {
              address: WALLET,
              chain_type: "svm",
              signing_mode: "human_sync",
              authorization_version: 0,
            });
      },
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const client = new AomiClient({ baseUrl: "https://api.test.invalid" });

    const result = await ensureSvmWalletBound(
      client,
      WALLET,
      async (message) => {
        expect(Buffer.from(message).toString()).toBe(MESSAGE);
        return Uint8Array.from([7, 7, 7]);
      },
    );

    expect(result).toMatchObject({
      status: "bound",
      state: { signing_mode: "human_sync" },
    });
    expect(
      calls.find((call) => call.path.endsWith("/commit"))?.body,
    ).toMatchObject({
      permit: { wallet: WALLET, mode: "bind" },
      signature: Buffer.from([7, 7, 7]).toString("base64"),
    });
  });

  it("treats an already-bound challenge and commit race as success", async () => {
    const sign = vi.fn(async () => Uint8Array.from([1]));
    await expect(
      ensureSvmWalletBoundVia(
        async () => {
          throw new Error("409 already_bound");
        },
        WALLET,
        sign,
      ),
    ).resolves.toEqual({ status: "already_bound" });
    expect(sign).not.toHaveBeenCalled();

    let challenged = false;
    await expect(
      ensureSvmWalletBoundVia(
        async () => {
          if (!challenged) {
            challenged = true;
            return challengeBody() as never;
          }
          throw new Error("409 already_bound");
        },
        WALLET,
        sign,
      ),
    ).resolves.toEqual({ status: "already_bound" });
  });

  it("recognizes only the kernel unbound-wallet signal", () => {
    expect(
      isUnboundWalletError(new Error("[err.type=signing_unbound_wallet]")),
    ).toBe(true);
    expect(isUnboundWalletError(new Error("signing_denied"))).toBe(false);
  });
});
