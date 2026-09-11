import "server-only";

import { createPublicKey } from "node:crypto";
import {
  exportJWK,
  importPKCS8,
  importSPKI,
  SignJWT,
  type JWK,
} from "jose";
import {
  verifyTelegramInitData,
  type VerifiedTelegramLaunch,
} from "@aomi-labs/account/telegram";
import { readAccountAuthEnv } from "@aomi-labs/account/better-auth/env";
import { findPrivyUserByCustomAuthId } from "@aomi-labs/account/providers";

const CUSTOM_AUTH_KEY_ID = "aomi-telegram-custom-auth-1";
const CUSTOM_AUTH_TTL_SECONDS = 5 * 60;
const TELEGRAM_LINK_MAX_AGE_MS = 5 * 60 * 1000;

type CustomAuthEnvironment = "development" | "staging" | "production";

export type TrustedTelegramLaunch = VerifiedTelegramLaunch & {
  customSubject: string;
};

/**
 * Maps a stable Telegram identity to the one Custom JWT identity that Privy
 * sees. Bot ids deliberately do not participate: a person must keep the same
 * Privy user when they enter through any approved Aomi bot.
 */
export function telegramCustomAuthSubject(input: {
  environment: CustomAuthEnvironment;
  telegramUserId: string;
}): string {
  return `aomi:telegram:${input.environment}:${input.telegramUserId}`;
}

export function customAuthEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): CustomAuthEnvironment {
  const backend = env.BACKEND_URL ?? env.AOMI_PROXY_BACKEND_URL ?? "";
  try {
    const host = new URL(backend).hostname;
    if (host === "api-staging.aomi.dev") return "staging";
    if (host === "api.aomi.dev") return "production";
  } catch {
    // Local development may not have a URL-shaped backend setting.
  }
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "staging";
  return "development";
}

export function allowedTelegramWidgetBotIds(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> {
  return new Set(
    (env.TELEGRAM_WIDGET_BOT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value)),
  );
}

/** Keep every Telegram-auth route on the same policy failure semantics. */
export function statusForTrustedTelegramFailure(reason: string): number {
  if (reason === "bot_not_allowed") return 403;
  if (reason === "bad_signature" || reason === "expired") return 401;
  return 400;
}

/** Verify both Telegram's signature and Aomi's allowed-bot policy. */
export function verifyTrustedTelegramLaunch(input: {
  initData: string;
  botId: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
}):
  | { ok: true; launch: TrustedTelegramLaunch }
  | { ok: false; reason: string } {
  const allowed = allowedTelegramWidgetBotIds(input.env);
  if (!allowed.has(input.botId)) return { ok: false, reason: "bot_not_allowed" };

  const verified = verifyTelegramInitData(input.initData, input.botId, {
    now: input.now,
    maxAgeMs: TELEGRAM_LINK_MAX_AGE_MS,
  });
  if (!verified.ok) return verified;

  return {
    ok: true,
    launch: {
      ...verified.launch,
      customSubject: telegramCustomAuthSubject({
        environment: customAuthEnvironment(input.env),
        telegramUserId: verified.launch.telegramUserId,
      }),
    },
  };
}

export async function issueTelegramCustomAuthJwt(input: {
  customSubject: string;
  privateKeyPem?: string;
  now?: Date;
  ttlSeconds?: number;
}): Promise<string> {
  const privateKeyPem = input.privateKeyPem ?? process.env.PRIVY_TELEGRAM_CUSTOM_AUTH_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error("telegram_custom_auth_not_configured");
  const now = input.now ?? new Date();
  const key = await importPKCS8(privateKeyPem, "ES256");
  return new SignJWT()
    .setProtectedHeader({ alg: "ES256", kid: CUSTOM_AUTH_KEY_ID })
    .setSubject(input.customSubject)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(
      Math.floor(now.getTime() / 1000) +
        (input.ttlSeconds ?? CUSTOM_AUTH_TTL_SECONDS),
    )
    .sign(key);
}

/** Public half of the dedicated Custom JWT key. Safe to expose at the JWKS URL. */
export async function telegramCustomAuthJwk(input: {
  privateKeyPem?: string;
} = {}): Promise<JWK> {
  const privateKeyPem = input.privateKeyPem ?? process.env.PRIVY_TELEGRAM_CUSTOM_AUTH_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error("telegram_custom_auth_not_configured");
  const publicKeyPem = createPublicKey(privateKeyPem).export({
    format: "pem",
    type: "spki",
  }) as string;
  const key = await importSPKI(publicKeyPem, "ES256");
  const jwk = await exportJWK(key);
  return { ...jwk, alg: "ES256", kid: CUSTOM_AUTH_KEY_ID, use: "sig" };
}

/**
 * Privy, not the browser, confirms that the current Privy identity owns this
 * Telegram Custom JWT identity. This is mandatory for the email-OTP path:
 * an OTP alone must not bind a Telegram account until Privy reports the link.
 */
export async function requirePrivyCustomAuthOwner(input: {
  customSubject: string;
  privyUserId: string;
}): Promise<void> {
  const env = readAccountAuthEnv();
  if (!env.privyAppId || !env.privyAppSecret) {
    throw new Error("telegram_custom_auth_not_configured");
  }
  const owner = await findPrivyUserByCustomAuthId({
    appId: env.privyAppId,
    appSecret: env.privyAppSecret,
    customUserId: input.customSubject,
  });
  if (owner !== input.privyUserId) {
    throw new Error("telegram_custom_auth_not_linked");
  }
}
