// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import {
  previewWalletAuthOrigin,
  withPreviewWalletAuthOrigin,
} from "../../account/src/better-auth/preview-origin";
import { verifySiwsMessage } from "../../account/src/better-auth/siws";
import { signInWithCliSiwe, signInWithCliSiws } from "./auth";

const canonical = "https://chat-staging.aomi.dev";
const preview = "https://portal-git-main-aomi-labs.vercel.app";
const env = { VERCEL_ENV: "preview", VERCEL_BRANCH_URL: preview };
const privateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe.each([canonical, preview])(
  "CLI wallet login through %s",
  (baseUrl) => {
    it.each(["siwe", "siws"])(
      "verifies a real %s signature on the public wallet domain",
      async (family) => {
        const solana = Keypair.generate();
        const address =
          family === "siwe"
            ? privateKeyToAccount(privateKey).address
            : solana.publicKey.toBase58();
        const nonce = "edgeOriginNonce123";
        const origins: string[] = [];
        let consumed = false;
        const fetchImpl: typeof fetch = async (input, init) => {
          const publicUrl = new URL(String(input));
          if (publicUrl.pathname === "/v1/account") {
            expect(new Headers(init?.headers).get("authorization")).toBe(
              "Bearer verified-session",
            );
            return Response.json({
              session: { betterAuthUserId: "canonical-account" },
            });
          }
          // Vercel receives its transport alias after Edge forwards the public URL.
          const request = new Request(
            new URL(publicUrl.pathname, preview),
            init,
          );
          return withPreviewWalletAuthOrigin(
            request,
            env,
            canonical,
            async () => {
              const origin = previewWalletAuthOrigin()!;
              origins.push(origin);
              if (publicUrl.pathname.endsWith("/nonce")) {
                // Better Auth's SIWE endpoint returns only nonce. SIWS advertises its domain.
                return Response.json(
                  family === "siwe"
                    ? { nonce }
                    : {
                        nonce,
                        domain: new URL(origin).host,
                        uri: origin,
                      },
                );
              }
              const body = (await request.json()) as {
                message: string;
                signature: string;
              };
              const valid =
                family === "siwe"
                  ? parseSiweMessage(body.message).nonce === nonce &&
                    (await verifySiweMessage({
                      message: body.message,
                      signature: body.signature as `0x${string}`,
                      address: address as `0x${string}`,
                      domain: new URL(origin).host,
                      nonce,
                    }))
                  : verifySiwsMessage({
                      ...body,
                      walletAddress: address,
                      chainId: "solana:devnet",
                      intent: "sign-in",
                      domain: new URL(origin).host,
                      uri: origin,
                      nonce,
                    });
              if (!valid || consumed)
                return Response.json(
                  { error: "invalid_wallet_proof" },
                  { status: 401 },
                );
              consumed = true;
              return Response.json(
                { success: true },
                { headers: { "set-auth-token": "verified-session" } },
              );
            },
          );
        };
        const result =
          family === "siwe"
            ? await signInWithCliSiwe({ baseUrl, privateKey, fetch: fetchImpl })
            : await signInWithCliSiws({
                baseUrl,
                privateKey: bs58.encode(solana.secretKey),
                chainId: "solana:devnet",
                fetch: fetchImpl,
              });
        expect(result.auth).toMatchObject({
          sessionToken: "verified-session",
          betterAuthUserId: "canonical-account",
        });
        expect(origins).toEqual([baseUrl, baseUrl]);
        expect(consumed).toBe(true);
      },
    );
  },
);

it.each(["file:///tmp/portal", "javascript:alert(1)"])(
  "rejects non-HTTP wallet login URL %s before fetching",
  async (baseUrl) => {
    const fetchImpl = vi.fn();
    await expect(
      signInWithCliSiwe({ baseUrl, privateKey, fetch: fetchImpl }),
    ).rejects.toThrow("HTTP or HTTPS");
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);
