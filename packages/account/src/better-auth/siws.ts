import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin, User } from "better-auth";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";

import { syncSiwsWalletsForUser } from "../service/account-service";

import { resolveWalletLogin } from "../service/wallet-login";

export const SIWS_PROVIDER_ID = "siws";
export const SIWS_DEFAULT_CLUSTER = "solana:mainnet";
export const SIWS_CLUSTERS = [
  SIWS_DEFAULT_CLUSTER,
  "solana:devnet",
  "solana:testnet",
] as const;

export type SiwsCluster = (typeof SIWS_CLUSTERS)[number];
export type SiwsIntent = "sign-in" | "link";

const SIWS_NONCE_TTL_MS = 15 * 60 * 1000;
const SIWS_ISSUED_AT_SKEW_MS = 5 * 60 * 1000;
const SIWS_ADDRESS = z.string().refine(validSolanaAddress, {
  message: "Invalid Solana wallet address",
});
const SIWS_CLUSTER = z.enum(SIWS_CLUSTERS);
// Linking moved to /v1/account/wallets/link; a link request here must not
// quietly become a sign-in.
const SIWS_SIGN_IN_ONLY = z.literal("sign-in").optional();
const SIWS_WALLET_APP = z
  .string()
  .transform((value) =>
    value
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 80),
  )
  .refine(Boolean, { message: "Wallet app cannot be empty" });

const nonceBody = z.object({
  walletAddress: SIWS_ADDRESS,
  chainId: SIWS_CLUSTER.optional().default(SIWS_DEFAULT_CLUSTER),
  intent: SIWS_SIGN_IN_ONLY,
});

const verifyBody = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  walletAddress: SIWS_ADDRESS,
  chainId: SIWS_CLUSTER.optional().default(SIWS_DEFAULT_CLUSTER),
  intent: SIWS_SIGN_IN_ONLY,
  walletApp: SIWS_WALLET_APP.optional(),
});

export type ParsedSiwsMessage = {
  statement: string;
  domain: string;
  address: string;
  uri: string;
  chainId: SiwsCluster;
  nonce: string;
  issuedAt: string;
};

export type AomiSiwsOptions = {
  domain: string;
  baseUrl: string;
  getNonce: () => Promise<string>;
  now?: () => number;
};

export function aomiSiwsPlugin(options: AomiSiwsOptions) {
  const now = options.now ?? Date.now;

  return {
    id: "aomi-siws",
    endpoints: {
      getSiwsNonce: createAuthEndpoint(
        "/siws/nonce",
        {
          method: "POST",
          body: nonceBody,
          requireRequest: true,
        },
        async (ctx) => {
          const { walletAddress, chainId } = ctx.body;
          const nonce = await options.getNonce();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: siwsVerificationIdentifier(nonce),
            value: JSON.stringify([walletAddress, chainId]),
            expiresAt: new Date(now() + SIWS_NONCE_TTL_MS),
          });
          return ctx.json({
            nonce,
            domain: options.domain,
            uri: options.baseUrl,
          });
        },
      ),
      verifySiwsMessage: createAuthEndpoint(
        "/siws/verify",
        {
          method: "POST",
          body: verifyBody,
          requireRequest: true,
        },
        async (ctx) => {
          const { message, signature, walletAddress, chainId, walletApp } =
            ctx.body;
          const parsed = parseSiwsMessage(message);
          const verification = parsed
            ? await ctx.context.internalAdapter.consumeVerificationValue(
                siwsVerificationIdentifier(parsed.nonce),
              )
            : null;
          if (
            !verification ||
            verification.value !== JSON.stringify([walletAddress, chainId])
          ) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid or expired SIWS nonce",
            });
          }

          if (
            !verifySiwsMessage({
              message,
              signature,
              walletAddress,
              chainId,
              intent: "sign-in",
              nonce: parsed!.nonce,
              domain: options.domain,
              uri: options.baseUrl,
              now: now(),
            })
          ) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid SIWS message or signature",
            });
          }

          const login = await resolveWalletLogin({
            family: "svm",
            address: walletAddress,
            chainId,
            email: siwsSyntheticEmail(walletAddress),
          });
          const user = await ctx.context.adapter.findOne<User>({
            model: "user",
            where: [{ field: "id", value: login.betterAuthUserId }],
          });
          if (!user) throw new APIError("INTERNAL_SERVER_ERROR");
          await syncSiwsWalletsForUser({
            aomiUserId: login.userId,
            betterAuthUserId: user.id,
            walletApp,
            walletAppAddress: walletAddress,
          });

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to create Better Auth SIWS session",
            });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            token: session.token,
            success: true,
            user_id: login.userId,
            user: {
              id: user.id,
              walletAddress,
              chainId,
            },
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

export function parseSiwsMessage(message: string): ParsedSiwsMessage | null {
  const lines = message.split(/\r?\n/);
  const header = lines[0]?.match(
    /^(.+) wants you to sign in with your Solana account:$/,
  );
  if (!header || !validSolanaAddress(lines[1] ?? "")) return null;
  const fields = {
    uri: readField(lines, "URI"),
    version: readField(lines, "Version"),
    chainId: readField(lines, "Chain ID"),
    nonce: readField(lines, "Nonce"),
    issuedAt: readField(lines, "Issued At"),
  };
  if (
    !fields.uri ||
    fields.version !== "1" ||
    !fields.chainId ||
    !SIWS_CLUSTERS.includes(fields.chainId as SiwsCluster) ||
    !fields.nonce ||
    !fields.issuedAt ||
    Number.isNaN(Date.parse(fields.issuedAt))
  ) {
    return null;
  }
  return {
    statement: lines[3] ?? "",
    domain: header[1],
    address: lines[1],
    uri: fields.uri,
    chainId: fields.chainId as SiwsCluster,
    nonce: fields.nonce,
    issuedAt: fields.issuedAt,
  };
}

export function verifySiwsMessage(input: {
  message: string;
  signature: string;
  walletAddress: string;
  chainId: SiwsCluster;
  intent: SiwsIntent;
  nonce: string;
  domain: string;
  uri: string;
  now?: number;
}): boolean {
  const parsed = parseSiwsMessage(input.message);
  if (!parsed) return false;
  const issuedAt = Date.parse(parsed.issuedAt);
  const now = input.now ?? Date.now();
  const expectedStatement =
    input.intent === "link"
      ? "Only sign this message if you want this Solana wallet attached to the current Aomi account."
      : "Sign in to Aomi.";
  if (
    parsed.statement !== expectedStatement ||
    parsed.address !== input.walletAddress ||
    parsed.chainId !== input.chainId ||
    parsed.nonce !== input.nonce ||
    normalizeDomain(parsed.domain) !== normalizeDomain(input.domain) ||
    normalizeUri(parsed.uri) !== normalizeUri(input.uri) ||
    issuedAt > now + SIWS_ISSUED_AT_SKEW_MS ||
    issuedAt < now - SIWS_NONCE_TTL_MS
  ) {
    return false;
  }

  try {
    const publicKey = bs58.decode(input.walletAddress);
    const signature = Buffer.from(input.signature, "base64");
    return (
      publicKey.length === nacl.sign.publicKeyLength &&
      signature.length === nacl.sign.signatureLength &&
      nacl.sign.detached.verify(
        new TextEncoder().encode(input.message),
        signature,
        publicKey,
      )
    );
  } catch {
    return false;
  }
}

export function validSolanaAddress(address: string): boolean {
  try {
    return bs58.decode(address).length === nacl.sign.publicKeyLength;
  } catch {
    return false;
  }
}

export function siwsIdentitySubject(address: string): string {
  return `solana:*:${address}`;
}

function siwsSyntheticEmail(address: string): string {
  return `svm-${Buffer.from(bs58.decode(address)).toString("hex")}@wallet.aomi.invalid`;
}

function siwsVerificationIdentifier(nonce: string): string {
  return `${SIWS_PROVIDER_ID}:sign-in:${nonce}`;
}

function readField(lines: readonly string[], field: string): string | null {
  const prefix = `${field}: `;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length) ?? null;
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^127\.0\.0\.1(?=:\d+$|$)/, "localhost");
}

function normalizeUri(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === "127.0.0.1") url.hostname = "localhost";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}
