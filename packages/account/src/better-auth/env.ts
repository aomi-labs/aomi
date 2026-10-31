export interface AccountAuthEnv {
  betterAuthSecret: string;
  betterAuthUrl: string;
  siweDomain: string;
  siweEmailDomain?: string;
  trustedOrigins: string[];
  privyAppId?: string;
  /** Server-only Privy app secret. Used as the Basic-auth password for the
   *  Privy REST API (`GET /v1/wallets`) to list wallets attested for a user.
   *  Never expose client-side. */
  privyAppSecret?: string;
  privyAccessTokenVerificationKey?: string;
  privyIdentityTokenVerificationKey?: string;
  paraAudience?: string;
  paraJwksUrl?: string;
  /** Server-only Para REST API key (`X-API-Key`). Used to list wallets attested
   *  for a user via `GET /v1/wallets`. Distinct from `paraAudience` (the public
   *  app id used as the JWT `aud`). Never expose client-side. */
  paraApiKey?: string;
  /** The one request header the edge's host overwrites with the client IP. */
  clientIpHeader: string;
}

type AccountAuthEnvInput = Record<string, string | undefined>;

const DEV_BETTER_AUTH_SECRET =
  "dev-better-auth-secret-change-me-at-least-32-bytes";

export function readAccountAuthEnv(
  env: AccountAuthEnvInput = process.env,
): AccountAuthEnv {
  const betterAuthUrl = resolveBetterAuthUrl(env);
  const url = new URL(betterAuthUrl);
  const allowDevDefaults = isAccountAuthLocalRuntime(env);
  return {
    betterAuthSecret: requiredAuthEnvValue({
      env,
      key: "BETTER_AUTH_SECRET",
      devDefault: DEV_BETTER_AUTH_SECRET,
      allowDevDefaults,
    }),
    betterAuthUrl,
    siweDomain: env.AOMI_AUTH_DOMAIN ?? url.host,
    siweEmailDomain: env.AOMI_AUTH_EMAIL_DOMAIN,
    trustedOrigins: uniqueOrigins([
      ...parseCsv(env.AOMI_TRUSTED_ORIGINS),
      betterAuthUrl,
    ]),
    // One server name per value. The browser reads its own NEXT_PUBLIC_ copy
    // of the Privy app id; the server never falls back to it.
    privyAppId: nonEmpty(env.PRIVY_APP_ID),
    privyAppSecret: nonEmpty(env.PRIVY_APP_SECRET),
    privyAccessTokenVerificationKey: nonEmpty(env.PRIVY_JWT_VERIFICATION_KEY),
    privyIdentityTokenVerificationKey: nonEmpty(
      env.PRIVY_IDENTITY_JWT_VERIFICATION_KEY,
    ),
    // Para's JWT `aud` is its own id, never the public API key.
    paraAudience: nonEmpty(env.PARA_JWT_AUDIENCE),
    paraJwksUrl: nonEmpty(env.PARA_JWKS_URL),
    paraApiKey: nonEmpty(env.PARA_API_SECRET_KEY),
    // Cloudflare sets CF-Connecting-IP at ingress; nothing upstream can forge it.
    clientIpHeader:
      nonEmpty(env.AOMI_CLIENT_IP_HEADER)?.toLowerCase() ?? "cf-connecting-ip",
  };
}

// An env var created with a blank value (easy to do in the Vercel dashboard/CLI)
// must behave like an unset one, or it would read as "configured" downstream.
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isAccountAuthLocalRuntime(
  env: AccountAuthEnvInput = process.env,
): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

function requiredAuthEnvValue(input: {
  env: AccountAuthEnvInput;
  key: "BETTER_AUTH_SECRET";
  devDefault: string;
  allowDevDefaults: boolean;
}): string {
  const value = input.env[input.key]?.trim();
  if (value && (input.allowDevDefaults || value !== input.devDefault)) {
    return value;
  }
  if (input.allowDevDefaults) return input.devDefault;
  throw new Error(
    `${input.key} must be configured outside NODE_ENV=development/test`,
  );
}

function resolveBetterAuthUrl(env: AccountAuthEnvInput): string {

  return (
    firstUrl(env.BETTER_AUTH_URL) ??
    "http://localhost:3001"
  );
}

function firstUrl(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return undefined;
  }
}

function uniqueOrigins(values: Array<string | undefined>): string[] {
  const origins: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const origin = normalizeUrl(value);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }
  return origins;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
