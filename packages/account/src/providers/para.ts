import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { VerifiedParaJwt, WalletFamily } from "../types";
import type {
  VerifiedProviderIdentity,
  WidgetProviderDescriptor,
} from "./descriptor";
import {
  validWalletAddress,
  type AttestedWallet,
  type ProviderLoginIdentifier,
} from "./wallet-attestation";

type ParaClaims = {
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  email?: string;
  email_verified?: boolean;
  wallets?: unknown[];
  connectedWallets?: unknown[];
  connected_wallets?: unknown[];
  data?: {
    email?: unknown;
    emailVerified?: unknown;
    email_verified?: unknown;
    identifier?: unknown;
    authType?: unknown;
    oAuthMethod?: unknown;
    wallets?: unknown;
    connectedWallets?: unknown;
    connected_wallets?: unknown;
  };
  [key: string]: unknown;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const PARA_WIDGET_JWKS_URLS = {
  BETA: "https://api.beta.getpara.com/.well-known/jwks.json",
  PROD: "https://api.getpara.com/.well-known/jwks.json",
} as const;

// Single owner of the Para environment ↔ host mapping. Sourced from the known
// JWKS URLs above so callers do not re-sniff Para hosts independently. A custom
// (non-standard) JWKS URL that does not carry the beta host falls back to prod,
// matching the historical substring behavior.
const PARA_BETA_JWKS_HOST = new URL(PARA_WIDGET_JWKS_URLS.BETA).host;

export function paraIssuerEnvironmentForJwksUrl(
  jwksUrl: string,
): "para:beta" | "para:prod" {
  return jwksUrl.includes(PARA_BETA_JWKS_HOST) ? "para:beta" : "para:prod";
}

const paraWidgetCredentialSchema = z.object({
  provider: z.literal("para"),
  environment: z.enum(["BETA", "PROD"]),
  provider_token: z.string().min(1),
  key_id: z.string().trim().min(1).optional(),
});

// Resolved lazily (per call) rather than at module load so that
// `PARA_API_BASE_URL` set in the runtime environment — notably prod, which
// points at the non-beta host — is honored even when this module was imported
// before env was populated. The default deliberately targets the BETA host:
// prod deployments are expected to set `PARA_API_BASE_URL` explicitly.
function paraWalletsUrl(): string {
  return (
    process.env.PARA_API_BASE_URL ?? "https://api.beta.getpara.com/v1/wallets"
  );
}

export async function verifyParaJwt(input: {
  token: string;
  expectedAudience: string;
  jwksUrl: string;
  keyId?: string;
}): Promise<VerifiedParaJwt> {
  const jwks = getJwks(input.jwksUrl);
  const { payload, protectedHeader } = await jwtVerify<ParaClaims>(
    input.token,
    jwks,
    { audience: input.expectedAudience, algorithms: ["RS256"] },
  );
  if (
    input.keyId &&
    protectedHeader.kid &&
    input.keyId !== protectedHeader.kid
  ) {
    throw new Error("Para JWT kid did not match the requested key id");
  }
  if (!payload.sub) throw new Error("Para JWT is missing sub");
  if (!payload.exp) throw new Error("Para JWT is missing exp");
  const nested = payload.data;
  const nestedEmail = stringClaim(nested?.email);
  const email = nestedEmail ?? stringClaim(payload.email);
  const identifier = stringClaim(nested?.identifier);
  const wallets = arrayClaim(nested?.wallets) ?? arrayClaim(payload.wallets);
  const connectedWallets =
    arrayClaim(nested?.connectedWallets) ??
    arrayClaim(nested?.connected_wallets) ??
    arrayClaim(payload.connectedWallets) ??
    arrayClaim(payload.connected_wallets);
  return {
    subject: payload.sub,
    audience: input.expectedAudience,
    expiresAt: payload.exp,
    email,
    emailVerified: Boolean(payload.email_verified || nestedEmail),
    displayLabel: email ?? identifier,
    wallets,
    connectedWallets,
    rawClaims: { ...payload },
  };
}

export function createParaWidgetDescriptor(
  jwksUrls: Readonly<Record<"BETA" | "PROD", string>> = PARA_WIDGET_JWKS_URLS,
): WidgetProviderDescriptor {
  return {
    id: "para",
    credentialSchema: paraWidgetCredentialSchema,
    policy: {
      subjectIsEnvironmentGlobal: true,
      widgetEnabled: true,
    },
    verifyWidgetCredential: async (input) =>
      verifyParaWidgetCredential({ ...input, jwksUrls }),
  };
}

export const paraWidgetDescriptor = createParaWidgetDescriptor();

export async function verifyParaWidgetCredential(input: {
  environment: string;
  providerToken: string;
  keyId?: string;
  jwksUrls?: Readonly<Record<"BETA" | "PROD", string>>;
  now?: Date;
}): Promise<VerifiedProviderIdentity> {
  const environment = input.environment.trim().toUpperCase();
  if (environment !== "BETA" && environment !== "PROD") {
    throw new Error("invalid_provider_environment");
  }
  const jwksUrl = (input.jwksUrls ?? PARA_WIDGET_JWKS_URLS)[environment];
  const { payload, protectedHeader } = await jwtVerify<ParaClaims>(
    input.providerToken,
    getJwks(jwksUrl),
    { algorithms: ["RS256"] },
  );
  if (protectedHeader.alg !== "RS256" || !protectedHeader.kid) {
    throw new Error("invalid_provider_token_header");
  }
  if (input.keyId && protectedHeader.kid !== input.keyId) {
    throw new Error("provider_token_kid_mismatch");
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const subject = requiredString(payload.sub, "sub");
  const audience = singleAudience(payload.aud);
  if (typeof payload.iat !== "number" || !Number.isInteger(payload.iat)) {
    throw new Error("provider_token_missing_iat");
  }
  if (typeof payload.exp !== "number" || !Number.isInteger(payload.exp)) {
    throw new Error("provider_token_missing_exp");
  }
  const issuedAt = payload.iat;
  const expiresAt = payload.exp;
  if (payload.nbf != null) {
    if (typeof payload.nbf !== "number" || !Number.isInteger(payload.nbf)) {
      throw new Error("provider_token_invalid_nbf");
    }
    if (payload.nbf > nowSeconds + 60) {
      throw new Error("provider_token_not_yet_valid");
    }
  }
  if (issuedAt > nowSeconds + 60) {
    throw new Error("provider_token_iat_in_future");
  }
  if (expiresAt <= issuedAt) {
    throw new Error("provider_token_invalid_lifetime");
  }
  if (expiresAt <= nowSeconds) {
    throw new Error("provider_token_expired");
  }

  const nested = objectClaim(payload.data, "data");
  const email = stringClaim(nested?.email) ?? stringClaim(payload.email);
  const nestedVerified = nested?.emailVerified ?? nested?.email_verified;
  const emailVerified =
    payload.email_verified === true || nestedVerified === true;
  // `data.wallets` is Para's own signed statement of the embedded wallets it
  // custodies for this subject. It carries exactly the trust of the `sub` we
  // bind the canonical account to: same RS256 signature, same JWKS, same
  // audience pinned to our API key — a client can choose which token to
  // present but cannot alter a field in it. Treating `sub` as authoritative
  // while calling this array unverifiable would be incoherent.
  //
  // Para's REST wallet list cannot replace it: `GET /v1/wallets` is indexed by
  // pregen login handle and does not return wallets a user created through the
  // client SDK, so it is a supplementary source (see
  // `requireAttestedProviderWallets`), not the proof.
  //
  // `connectedWallets` stays discarded, and that is the boundary that matters:
  // those are external wallets attached to the session, not Para-custodied, so
  // they can never back hosted signing.
  const walletAttestations = paraTokenWalletAttestations(
    walletClaims(nested?.wallets ?? payload.wallets, "wallets"),
  );
  walletClaims(
    nested?.connectedWallets ??
      nested?.connected_wallets ??
      payload.connectedWallets ??
      payload.connected_wallets,
    "connectedWallets",
  );

  return {
    provider: "para",
    issuerEnvironment: `para:${environment.toLowerCase()}`,
    tenantId: audience,
    subject,
    expiresAt,
    email: email ? { value: email, verified: emailVerified } : undefined,
    loginIdentifier: paraLoginIdentifier(nested),
    walletAttestations,
    metadata: {
      audience,
      expiresAt,
      displayLabel: email ?? stringClaim(nested?.identifier),
    },
  };
}

/** The login handle Para verified for this session (`data.authType` +
 *  `data.identifier`). Para's wallet API is partner-scoped and keyed by this
 *  pair — the JWT `sub` is a Para user id and no `userIdentifierType` names
 *  it — so this is what makes a server-side wallet attestation possible. */
function paraLoginIdentifier(
  nested: Record<string, unknown> | undefined,
): ProviderLoginIdentifier | undefined {
  const type = stringClaim(nested?.authType);
  const value = stringClaim(nested?.identifier);
  return type && value ? { type, value } : undefined;
}

/** Convert Para's signed `data.wallets` entries into attested wallets. Only
 *  wallets on a family we can key a `public_keys` row for, with a wallet id and
 *  a well-formed address, survive; the entries carry no `scheme` because
 *  membership in this array is itself the custody signal. */
function paraTokenWalletAttestations(
  claims: readonly unknown[],
): AttestedWallet[] {
  const wallets: AttestedWallet[] = [];
  for (const claim of claims) {
    const row = claim as { id?: unknown; type?: unknown; address?: unknown };
    const family = paraWalletFamily(stringClaim(row.type));
    const providerWalletId = stringClaim(row.id);
    if (!family || !providerWalletId) continue;
    if (!validWalletAddress(family, row.address)) continue;
    wallets.push({
      provider: "para",
      providerWalletId,
      family,
      address: row.address,
      chainScope: null,
    });
  }
  return wallets;
}

export type ParaUserIdentifierType =
  | "EMAIL"
  | "PHONE"
  | "CUSTOM_ID"
  | "GUEST_ID"
  | "DISCORD"
  | "TWITTER"
  | "TELEGRAM"
  | "FARCASTER";

/** Map a Para `authType` onto the `userIdentifierType` its REST wallet API
 *  accepts. Unmapped types — `externalWallet` above all — have no REST
 *  equivalent: an external wallet is not Para-custodied, so there is nothing
 *  to attest and callers must fail closed rather than guess an identifier. */
export function paraUserIdentifierType(
  authType: string | undefined | null,
): ParaUserIdentifierType | null {
  switch (authType?.trim().toLowerCase()) {
    case "email":
      return "EMAIL";
    case "phone":
      return "PHONE";
    case "telegram":
      return "TELEGRAM";
    case "farcaster":
      return "FARCASTER";
    case "discord":
      return "DISCORD";
    case "twitter":
    case "x":
      return "TWITTER";
    case "guest":
      return "GUEST_ID";
    default:
      return null;
  }
}

/** Fetch every wallet Para attests is owned by the user identified by
 * `userIdentifier` / `userIdentifierType`. Filters to embedded/MPC wallets
 * Para custody-shares; external imports must still go through SIWE/SIWS. */
export async function listParaWalletsForUser(input: {
  apiKey: string;
  userIdentifier: string;
  userIdentifierType?: ParaUserIdentifierType;
}): Promise<AttestedWallet[]> {
  const headers: Record<string, string> = {
    "X-API-Key": input.apiKey,
  };
  const identifierType = input.userIdentifierType ?? "CUSTOM_ID";

  const out: AttestedWallet[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const url = new URL(paraWalletsUrl());
    url.searchParams.set("userIdentifier", input.userIdentifier);
    url.searchParams.set("userIdentifierType", identifierType);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(
        `para wallets: list failed (${res.status} ${res.statusText})`,
      );
    }
    const body = (await res.json()) as {
      wallets?: ParaWalletRow[];
      data?: ParaWalletRow[];
      pagination?: { cursor?: string | null; hasMore?: boolean };
    };
    const rows = Array.isArray(body.wallets)
      ? body.wallets
      : Array.isArray(body.data)
        ? body.data
        : [];

    for (const row of rows) {
      const attested = normalizeParaWalletRow(row);
      if (attested) out.push(attested);
    }

    const next = body.pagination?.cursor ?? undefined;
    cursor = next && body.pagination?.hasMore !== false ? next : undefined;
    if (!cursor) break;
  }
  return out;
}

interface ParaWalletRow {
  id?: string;
  address?: string;
  type?: string;
  scheme?: string;
  status?: string;
}

function normalizeParaWalletRow(row: ParaWalletRow): AttestedWallet | null {
  const family = paraWalletFamily(row.type);
  if (!family) return null;
  if (!row.id || typeof row.id !== "string") return null;
  if (!validWalletAddress(family, row.address)) return null;
  if (!isEmbeddedScheme(row.scheme)) return null;
  // Para returns an address before key generation finishes and says to read
  // `status`, not the presence of `address`. Linking a `creating` wallet would
  // put a not-yet-signable key in `public_keys`.
  if (row.status && row.status.toLowerCase() !== "ready") return null;

  return {
    provider: "para",
    providerWalletId: row.id,
    family,
    address: row.address,
    chainScope: null,
  };
}

function paraWalletFamily(type: string | undefined): WalletFamily | null {
  switch (type) {
    case "EVM":
    case "ETHEREUM":
      return "evm";
    case "SOLANA":
      return "svm";
    default:
      return null;
  }
}

/** MPC / embedded custody schemes Para uses for non-extractable embedded
 * wallets. `DKLS` and `CGGMP` cover EVM and Cosmos, `ED25519` covers Solana and
 * Stellar — Para's documented `scheme` enum is exactly these three, and every
 * one of them is a Para-held key share. `FROST` and any other `*MPC*` name stay
 * accepted for forward compatibility. Anything else — or a missing scheme — is
 * treated as non-custodied and never becomes a `public_keys` row. */
function isEmbeddedScheme(scheme: string | undefined): boolean {
  if (!scheme) return false;
  const upper = scheme.toUpperCase();
  return (
    upper === "DKLS" ||
    upper === "CGGMP" ||
    upper === "ED25519" ||
    upper === "FROST" ||
    upper.includes("MPC")
  );
}

function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(url);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, jwks);
  return jwks;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function arrayClaim(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function requiredString(value: unknown, claim: string): string {
  const result = stringClaim(value);
  if (!result) throw new Error(`provider_token_missing_${claim}`);
  return result;
}

function singleAudience(value: unknown): string {
  // Align with the native provider path (jose's `audience` option), which
  // accepts an array `aud`. A single-element array carries the same single
  // tenant as the string form, so unwrap it; arrays with zero or multiple
  // entries are genuinely ambiguous for a tenant boundary and stay rejected.
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value) && value.length === 1
        ? value[0]
        : undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("provider_token_invalid_aud");
  }
  const audience = raw.trim();
  if (audience.length > 512 || /\s/.test(audience)) {
    throw new Error("provider_token_invalid_aud");
  }
  return audience;
}

function objectClaim(
  value: unknown,
  claim: string,
): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`provider_token_invalid_${claim}`);
  }
  return value as Record<string, unknown>;
}

function walletClaims(value: unknown, claim: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`provider_token_invalid_${claim}`);
  }
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`provider_token_invalid_${claim}`);
    }
    const record = row as Record<string, unknown>;
    for (const key of ["id", "type", "address"] as const) {
      if (record[key] != null && typeof record[key] !== "string") {
        throw new Error(`provider_token_invalid_${claim}`);
      }
    }
  }
  return value;
}
