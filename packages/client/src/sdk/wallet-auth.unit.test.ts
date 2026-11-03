// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

import { createAomiDeviceGrantManager } from "../oauth";
import { solanaSigner } from "../solana";
import { Aomi } from "./aomi";
import { wallet } from "./auth";

const baseUrl = "https://chat.aomi.dev";
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);

describe("wallet sign-in", () => {
  it("signs in with SIWE once and sends the session as the bearer", async () => {
    const calls: { path: string; auth: string | null; body?: string }[] = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          String(input instanceof Request ? input.url : input),
        );
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        calls.push({
          path: url.pathname,
          auth: headers.get("authorization"),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (url.pathname === "/api/auth/siwe/nonce")
          return Response.json({ nonce: "abcdefgh12345678" });
        if (url.pathname === "/api/auth/siwe/verify")
          return Response.json(
            { token: "body-token" },
            { headers: { "set-auth-token": "session-token" } },
          );
        return Response.json({ user: { id: "u1" }, linkedAccounts: [] });
      },
    );
    const aomi = new Aomi({ baseUrl, fetch, auth: wallet(account) });

    await aomi.account.me();
    await aomi.account.me();

    expect(aomi.auth.mode).toBe("wallet");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/siwe/nonce",
      "/api/auth/siwe/verify",
      "/v1/account",
      "/v1/account",
    ]);
    const { message, signature } = JSON.parse(calls[1]!.body!);
    expect(message).toContain(account.address);
    expect(message).toContain("Nonce: abcdefgh12345678");
    expect(await account.signMessage({ message })).toBe(signature);
    expect(calls[2]!.auth).toBe("Bearer session-token");
  });

  it("picks SIWE or SIWS by the signer", () => {
    expect(wallet(account)).toMatchObject({ family: "evm", chainId: 1 });
    expect(
      wallet(solanaSigner(Keypair.generate()), { cluster: "solana:devnet" }),
    ).toMatchObject({ family: "svm", cluster: "solana:devnet" });
  });

  it("signs in with SIWS for a Solana signer", async () => {
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    const calls: { path: string; body: Record<string, string> }[] = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({
          path: url.pathname,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        if (url.pathname === "/api/auth/siws/nonce")
          return Response.json({
            nonce: "abcdefgh12345678",
            domain: "chat.aomi.dev",
            uri: baseUrl,
          });
        if (url.pathname === "/api/auth/siws/verify")
          return Response.json({ token: "siws-token" });
        return Response.json({ user: { id: "u1" }, linkedAccounts: [] });
      },
    );
    const aomi = new Aomi({
      baseUrl,
      fetch,
      auth: wallet(solanaSigner(keypair)),
    });

    await aomi.account.me();

    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/siws/nonce",
      "/api/auth/siws/verify",
      "/v1/account",
    ]);
    expect(calls[0]!.body).toEqual({
      walletAddress: address,
      chainId: "solana:mainnet",
    });
    const { message, signature, walletAddress } = calls[1]!.body;
    expect(walletAddress).toBe(address);
    expect(message).toContain(`${address}\n\nSign in to Aomi.`);
    expect(message).toContain("Chain ID: solana:mainnet");
    expect(
      nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        Buffer.from(signature!, "base64"),
        keypair.publicKey.toBytes(),
      ),
    ).toBe(true);
  });

  it("registers a device client when none is given", async () => {
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/.well-known/oauth-authorization-server"))
          return Response.json({
            issuer: `${baseUrl}/api/auth`,
            authorization_endpoint: `${baseUrl}/api/auth/oauth2/authorize`,
            token_endpoint: `${baseUrl}/api/auth/oauth2/token`,
            revocation_endpoint: `${baseUrl}/api/auth/oauth2/revoke`,
            device_authorization_endpoint: `${baseUrl}/api/auth/device/code`,
            registration_endpoint: `${baseUrl}/api/auth/oauth2/register`,
            jwks_uri: `${baseUrl}/api/auth/jwks`,
          });
        expect(url).toBe(`${baseUrl}/api/auth/oauth2/register`);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          client_name: "Aomi CLI",
          token_endpoint_auth_method: "none",
          resources: [`${baseUrl}/v1`],
        });
        return Response.json({ client_id: "registered" });
      },
    );
    const manager = await createAomiDeviceGrantManager({
      portalBaseUrl: baseUrl,
      clientName: "Aomi CLI",
      fetch,
      onVerification: vi.fn(),
    });
    await manager.put({
      issuer: `${baseUrl}/api/auth`,
      clientId: "registered",
      accessToken: "a",
      expiresAt: Date.now() + 60_000,
      resource: `${baseUrl}/v1`,
      scopes: ["agent:read"],
    });
    expect(await manager.grants()).toHaveLength(1);
  });
});
