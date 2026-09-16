import { readAccountAuthEnv, type AccountAuthEnv } from "../better-auth/env";
import type {
  AomiAccountCredential,
  AccountCredentialProvider,
} from "../types";
import { paraIssuerEnvironmentForJwksUrl, verifyParaJwt } from "./para";
import { verifyPrivyToken } from "./privy";
import {
  validWalletAddress,
  type AttestedWallet,
  type AttestedWalletProvider,
} from "./wallet-attestation";
import type { VerifiedProviderIdentity } from "./descriptor";

export type VerifiedProviderToken = {
  subject: string;
  expiresAt: number;
  email?: string;
  emailVerified?: boolean;
  displayLabel?: string;
  providerMetadata: Record<string, unknown>;
  walletAttestations?: AttestedWallet[];
};

export type VerifiedProviderTokenCredential = {
  provider: AccountCredentialProvider;
  issuerEnvironment: string;
  tenantId: string;
  token: VerifiedProviderToken;
  walletAttestationProvider: AttestedWalletProvider;
};

export type VerifiedProviderCredential = VerifiedProviderTokenCredential;

type NormalizedProviderCredential = {
  kind: "provider";
} & ProviderTokenCredential;

export type ProviderTokenCredential = {
  provider: AccountCredentialProvider;
  tokenKind?: string;
  providerToken: string;
  keyId?: string;
};

export type ProviderCredentialVerifier = (
  credential: ProviderTokenCredential,
) => Promise<VerifiedProviderTokenCredential>;

export type ProviderCredentialVerifierRegistry = Record<
  string,
  ProviderCredentialVerifier | undefined
>;

export type VerifyProviderCredentialOptions = {
  env?: AccountAuthEnv;
  verifiers?: ProviderCredentialVerifierRegistry;
};

export async function verifyProviderCredential(
  credential: AomiAccountCredential,
  optionsOrEnv: VerifyProviderCredentialOptions | AccountAuthEnv = {},
): Promise<VerifiedProviderCredential> {
  const options = normalizeVerifyOptions(optionsOrEnv);
  const parsed = normalizeCredential(credential);

  const verifiers =
    options.verifiers ??
    createDefaultProviderCredentialVerifiers(
      options.env ?? readAccountAuthEnv(),
    );
  const verifier = verifiers[parsed.provider];
  if (!verifier) {
    throw new Error(
      `Unsupported account credential provider: ${parsed.provider}`,
    );
  }
  return verifier({
    provider: parsed.provider,
    tokenKind: parsed.tokenKind,
    providerToken: parsed.providerToken,
    ...(parsed.keyId ? { keyId: parsed.keyId } : {}),
  });
}

export function isVerifiedProviderTokenCredential(
  verified: VerifiedProviderCredential,
): verified is VerifiedProviderTokenCredential {
  return "token" in verified;
}

export function toVerifiedProviderIdentity(
  verified: VerifiedProviderTokenCredential,
): VerifiedProviderIdentity {
  return {
    provider: verified.provider,
    issuerEnvironment: verified.issuerEnvironment,
    tenantId: verified.tenantId,
    subject: verified.token.subject,
    expiresAt: verified.token.expiresAt,
    email: verified.token.email
      ? {
          value: verified.token.email,
          verified: Boolean(verified.token.emailVerified),
        }
      : undefined,
    walletAttestations: verified.token.walletAttestations ?? [],
    metadata: verified.token.providerMetadata,
  };
}

export function createDefaultProviderCredentialVerifiers(
  env: AccountAuthEnv = readAccountAuthEnv(),
): ProviderCredentialVerifierRegistry {
  return {
    privy: createPrivyCredentialVerifier(env),
    para: createParaCredentialVerifier(env),
  };
}

function createPrivyCredentialVerifier(
  env: AccountAuthEnv,
): ProviderCredentialVerifier {
  return async (credential) => {
    if (!env.privyAppId) throw new Error("Privy app id is not configured");
    const tokenKind = resolvePrivyTokenKind(credential.tokenKind);
    const token = await verifyPrivyToken({
      token: credential.providerToken,
      tokenKind,
      appId: env.privyAppId,
      accessTokenVerificationKey: env.privyAccessTokenVerificationKey,
      identityTokenVerificationKey: env.privyIdentityTokenVerificationKey,
    });
    return {
      provider: "privy",
      // KNOWN/DOCUMENTED: the Privy issuer environment is hardcoded to
      // "privy:prod". Privy does not expose a beta/staging issuer distinct from
      // prod for these tokens, so there is a single environment today. Revisit
      // only if Privy introduces a separate non-prod issuer; do not redesign
      // the environment plumbing for this alone.
      issuerEnvironment: "privy:prod",
      tenantId: token.audience,
      walletAttestationProvider: "privy",
      token: {
        subject: token.subject,
        expiresAt: token.expiresAt,
        email: token.email,
        emailVerified: token.emailVerified,
        displayLabel: token.displayLabel,
        providerMetadata: {
          expiresAt: token.expiresAt,
          displayLabel: token.displayLabel,
          linkedAccounts: token.linkedAccounts,
        },
        walletAttestations: privyTokenWalletAttestations(token.linkedAccounts),
      },
    };
  };
}

function createParaCredentialVerifier(
  env: AccountAuthEnv,
): ProviderCredentialVerifier {
  return async (credential) => {
    // The Para session JWT is the only Para token shape accepted today; keep
    // the verifier branch local so future Para variants do not affect callers.
    if (!env.paraAudience || !env.paraJwksUrl) {
      throw new Error("Para JWKS verification is not configured");
    }
    const token = await verifyParaJwt({
      token: credential.providerToken,
      expectedAudience: env.paraAudience,
      jwksUrl: env.paraJwksUrl,
      keyId: credential.keyId,
    });
    return {
      provider: "para",
      issuerEnvironment: paraIssuerEnvironmentForJwksUrl(env.paraJwksUrl),
      tenantId: token.audience,
      walletAttestationProvider: "para",
      token: {
        subject: token.subject,
        expiresAt: token.expiresAt,
        email: token.email,
        emailVerified: token.emailVerified,
        displayLabel: token.displayLabel,
        providerMetadata: {
          expiresAt: token.expiresAt,
          displayLabel: token.displayLabel,
          wallets: token.wallets,
          connectedWallets: token.connectedWallets,
        },
        walletAttestations: paraTokenWalletAttestations([
          ...(token.wallets ?? []),
          ...(token.connectedWallets ?? []),
        ]),
      },
    };
  };
}

export function paraTokenWalletAttestations(
  rows: readonly unknown[],
): AttestedWallet[] {
  const wallets: AttestedWallet[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const family = paraTokenWalletFamily(record.type);
    const address = stringValue(record.address);
    const providerWalletId = stringValue(record.id);
    if (!family || !address || !providerWalletId) continue;
    if (!validWalletAddress(family, address)) continue;
    const key = `${family}:${family === "evm" ? address.toLowerCase() : address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wallets.push({
      provider: "para",
      providerWalletId,
      family,
      address,
      chainScope: null,
    });
  }
  return wallets;
}

export function privyTokenWalletAttestations(
  rows: readonly unknown[] | undefined,
): AttestedWallet[] {
  const wallets: AttestedWallet[] = [];
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (record.type !== "wallet" || !isPrivyEmbeddedWallet(record)) continue;
    const family = privyTokenWalletFamily(
      record.chain_type ?? record.chainType,
    );
    const address = stringValue(record.address);
    if (!family || !address || !validWalletAddress(family, address)) continue;
    const providerWalletId =
      stringValue(record.id) ?? stringValue(record.wallet_id) ?? address;
    const key = `${family}:${family === "evm" ? address.toLowerCase() : address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wallets.push({
      provider: "privy",
      providerWalletId,
      family,
      address,
      chainScope: null,
    });
  }
  return wallets;
}

function paraTokenWalletFamily(
  value: unknown,
): AttestedWallet["family"] | null {
  switch (String(value ?? "").toUpperCase()) {
    case "EVM":
    case "ETHEREUM":
      return "evm";
    case "SOLANA":
    case "SVM":
      return "svm";
    default:
      return null;
  }
}

function privyTokenWalletFamily(
  value: unknown,
): AttestedWallet["family"] | null {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "ethereum" || normalized === "evm") return "evm";
  if (normalized === "solana" || normalized === "svm") return "svm";
  return null;
}

function isPrivyEmbeddedWallet(row: Record<string, unknown>): boolean {
  const markers = [
    row.wallet_client_type,
    row.walletClientType,
    row.wallet_client,
    row.walletClient,
    row.connector_type,
    row.connectorType,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .filter(Boolean);
  return markers.some(
    (marker) =>
      marker === "privy" ||
      marker === "embedded" ||
      marker === "smart_wallet" ||
      marker === "smart-wallet",
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function providerSessionUserSeed(
  verified: VerifiedProviderTokenCredential,
): { email: string; emailVerified: boolean; name: string } {
  const providerEmail = verified.token.email?.trim();
  const verifiedEmail =
    providerEmail && verified.token.emailVerified ? providerEmail : undefined;
  const displayLabel = verified.token.displayLabel?.trim() || undefined;
  const email = verifiedEmail ?? providerSubjectEmail(verified);
  return {
    email,
    emailVerified: Boolean(verifiedEmail),
    name: verifiedEmail ?? displayLabel ?? `${verified.provider} user`,
  };
}

function providerSubjectEmail(
  verified: VerifiedProviderTokenCredential,
): string {
  const subject = verified.token.subject.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${verified.provider}-${subject}@auth.aomi.local`;
}

/** Resolve the Privy token kind, rejecting unrecognized values instead of
 * silently degrading them to `identity_token`. An absent value keeps the
 * historical default (identity token). */
function resolvePrivyTokenKind(
  value: string | undefined,
): "identity_token" | "access_token" {
  if (value === undefined || value === "identity_token") {
    return "identity_token";
  }
  if (value === "access_token") return "access_token";
  throw new Error("invalid_provider_token_kind");
}

function normalizeCredential(
  credential: AomiAccountCredential,
): NormalizedProviderCredential {
  const provider = credential.provider.trim().toLowerCase();
  if (!provider) throw new Error("Account credential provider is required");
  if (!credential.providerToken) {
    throw new Error("Account provider credential is required");
  }
  return {
    kind: "provider",
    provider,
    tokenKind: credential.tokenKind,
    providerToken: credential.providerToken,
    keyId: credential.keyId,
  };
}

function normalizeVerifyOptions(
  value: VerifyProviderCredentialOptions | AccountAuthEnv,
): VerifyProviderCredentialOptions {
  if ("betterAuthSecret" in value) return { env: value };
  return value;
}
