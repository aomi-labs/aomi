import { getPool } from "../db/pool";
import type { PoolClient } from "pg";
import {
  buildAccountResponse,
  countLoginFactors,
  createAomiUser,
  deactivateAomiUser,
  deleteBetterAuthSiweWallet,
  deleteBetterAuthSiwsWallet,
  findAuthIdentityById,
  findAomiUserById,
  claimTelegramSessionOwner as claimTelegramSessionOwnerQuery,
  findSignalOwner,
  findWalletById,
  listBetterAuthSiweWallets,
  listBetterAuthSiwsWallets,
  listWalletsForUser,
  lockIdentityResolutionKeys,
  logAccountEvent,
  revokeAllAuthIdentitiesForUser,
  revokeAllWalletsForUser,
  revokeAuthIdentity,
  revokeWallet,
  runAomiAuthSchema,
  touchAomiUser,
  updateAuthIdentityLabel,
  updateAomiUserProfile,
  updateWalletLabel,
  upsertAuthIdentity,
  upsertEmailIdentity,
  upsertWallet,
  withTransaction,
} from "../db/queries";
import { createDefaultWalletAttesters } from "../providers/default-wallet-attesters";
import {
  type AttestedWallet,
  type AttestedWalletProvider,
  type ProviderLoginIdentifier,
  type WalletAttestationLogger,
  type WalletAttesterRegistry,
} from "../providers/wallet-attestation";
import { observeAccountInternalFailure } from "../observability";
import {
  IDENTITY_SCOPES,
  type AomiAccountResponse,
  type AomiUserId,
  type AuthIdentityProvider,
  type DbAomiUser,
  type DbAomiWallet,
  type LinkedVia,
  type SignalRef,
  type SignalResolution,
  type WalletFamily,
  type WalletKind,
} from "../types";
import { normalizeWalletAddress } from "./wallet-normalization";
import {
  lockSignalRefs,
  resolveVerifiedProviderIdentity,
} from "./identity-resolution";
import { deleteWidgetSessionsForProviderIdentity } from "../widget-auth/store";
import { mergeGuestAccount } from "./account-merge";
import { shortAddress } from "@aomi-labs/client";

// Historically this applied the portal-owned `aomi_*` schema. AUTH-001 moves
// durable account state to the shared backend canonical tables, so the hook now
// only preserves the existing startup/error behavior around schema readiness.
let accountSchemaReady: Promise<void> | null = null;

// Internal identities (BetterAuth sessions, first-party wallet claims) carry no
// provider-token expiry; this sentinel marks them non-expiring for the
// resolver's freshness checks.
const NON_EXPIRING_IDENTITY_EXPIRES_AT = Number.MAX_SAFE_INTEGER;

export async function ensureAccountSchema(): Promise<void> {
  if (!accountSchemaReady) {
    accountSchemaReady = runAomiAuthSchema(getPool()).catch((error) => {
      accountSchemaReady = null;
      throw error;
    });
  }
  await accountSchemaReady;
}

export async function claimTelegramSessionOwner(input: {
  sessionId: string;
  telegramUserId: string;
  db?: import("pg").Pool | PoolClient;
}): Promise<AomiUserId | null> {
  if (!input.db) await ensureAccountSchema();
  return claimTelegramSessionOwnerQuery(input);
}

/** Finds the canonical account that has explicitly linked this Telegram ID. */
export async function findAomiUserForTelegram(
  telegramUserId: string,
): Promise<AomiUserId | null> {
  await ensureAccountSchema();
  return findSignalOwner({
    type: "identity",
    provider: "telegram",
    ...IDENTITY_SCOPES.telegram,
    subject: telegramUserId,
  });
}

export async function getOrCreateAomiUserForBetterAuthSession(input: {
  betterAuthUserId: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  avatarUrl?: string | null;
  accessSignals?: SignalRef[];
  onResolved?: (user: DbAomiUser, db: PoolClient) => Promise<void>;
}): Promise<DbAomiUser> {
  await ensureAccountSchema();
  const mappedOwner = await findSignalOwner({
    type: "identity",
    provider: "better_auth",
    ...IDENTITY_SCOPES.betterAuth,
    subject: input.betterAuthUserId,
  });
  const walletSignals = mappedOwner
    ? []
    : await betterAuthWalletSignals(input.betterAuthUserId);
  const verifiedEmail = input.email && input.emailVerified ? input.email : null;
  const resolution = await resolveVerifiedProviderIdentity({
    identity: {
      provider: "better_auth",
      ...IDENTITY_SCOPES.betterAuth,
      subject: input.betterAuthUserId,
      expiresAt: NON_EXPIRING_IDENTITY_EXPIRES_AT,
      email: input.email
        ? { value: input.email, verified: Boolean(input.emailVerified) }
        : undefined,
      walletAttestations: [],
      metadata: { source: "betterauth_session" },
    },
    policy: { subjectIsEnvironmentGlobal: false },
    recoverySignals: [
      ...(input.accessSignals ?? []),
      ...walletSignals,
      ...(verifiedEmail
        ? [{ type: "email" as const, email: verifiedEmail }]
        : []),
    ],
    displayName: input.name ?? input.email,
    avatarUrl: input.avatarUrl,
    // Persist the verified-email login factor in the same advisory-locked
    // transaction that creates/attaches the user. If that email already belongs
    // to another canonical user the upsert throws
    // `identity_already_linked_to_another_account`; because that is a
    // non-recoverable error the whole transaction rolls back, so a failed email
    // link can never leave a freshly created user orphaned.
    onResolved:
      verifiedEmail || input.onResolved
        ? async (result, db) => {
            if (verifiedEmail) {
              await upsertEmailIdentity({
                userId: result.user.id,
                email: verifiedEmail,
                db,
              });
            }
            await input.onResolved?.(result.user, db);
          }
        : undefined,
  });
  await logAccountEvent({
    userId: resolution.user.id,
    eventType: resolution.created ? "user.created" : "session.attached",
    data: { betterAuthUserId: input.betterAuthUserId },
  });
  return resolution.user;
}

/** Keep a guest's chats when Better Auth upgrades an anonymous user: a new
 * login adopts the guest's account, and a login that already opens an account
 * gets the guest merged into it. */
export async function linkAnonymousCanonicalAccount(input: {
  anonymousBetterAuthUserId: string;
  newBetterAuthUserId: string;
  newEmail?: string | null;
  newEmailVerified?: boolean;
  newName?: string | null;
  newAvatarUrl?: string | null;
}): Promise<AomiUserId> {
  const anonymous = await getOrCreateAomiUserForBetterAuthSession({
    betterAuthUserId: input.anonymousBetterAuthUserId,
  });
  const newSignal: SignalRef = {
    type: "identity",
    provider: "better_auth",
    ...IDENTITY_SCOPES.betterAuth,
    subject: input.newBetterAuthUserId,
  };
  return withTransaction(async (db) => {
    await lockIdentityResolutionKeys(
      [
        `identity:better_auth:${input.anonymousBetterAuthUserId}`,
        `identity:better_auth:${input.newBetterAuthUserId}`,
      ],
      db,
    );
    const newOwner = await findSignalOwner(newSignal, db);
    if (newOwner && newOwner !== anonymous.id) {
      await mergeGuestAccount({
        guestBetterAuthUserId: input.anonymousBetterAuthUserId,
        accountUserId: newOwner,
        db,
      });
      return newOwner;
    }
    await revokeAuthIdentity({
      userId: anonymous.id,
      provider: "better_auth",
      ...IDENTITY_SCOPES.betterAuth,
      subject: input.anonymousBetterAuthUserId,
      db,
    });
    await upsertAuthIdentity({
      userId: anonymous.id,
      provider: "better_auth",
      ...IDENTITY_SCOPES.betterAuth,
      subject: input.newBetterAuthUserId,
      email:
        input.newEmail && input.newEmailVerified ? input.newEmail : undefined,
      displayLabel: input.newName,
      providerMetadata: { source: "betterauth_anonymous_link" },
      db,
    });
    return anonymous.id;
  });
}

export function isIdentityAlreadyLinkedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "identity_already_linked_to_another_account"
  );
}

export async function betterAuthWalletSignals(
  betterAuthUserId: string,
  db?: Parameters<typeof listBetterAuthSiweWallets>[1],
): Promise<SignalRef[]> {
  const [evmWallets, svmWallets] = await Promise.all([
    listBetterAuthSiweWallets(betterAuthUserId, db),
    listBetterAuthSiwsWallets(betterAuthUserId, db),
  ]);
  return [
    ...evmWallets.map((wallet) => ({
      type: "wallet" as const,
      family: "evm" as const,
      normalizedAddress: normalizeWalletAddress("evm", wallet.address),
      chainScope: null,
    })),
    ...svmWallets.map((wallet) => ({
      type: "wallet" as const,
      family: "svm" as const,
      normalizedAddress: normalizeWalletAddress("svm", wallet.address),
      chainScope: null,
    })),
  ];
}

export async function getAccountResponseForBetterAuthSession(input: {
  betterAuthUserId: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  avatarUrl?: string | null;
  expiresAt?: Date | string | number | null;
  fresh?: boolean;
}): Promise<AomiAccountResponse> {
  const user = await getOrCreateAomiUserForBetterAuthSession(input);
  return buildAccountResponse({
    user,
    session: {
      carrier: "better_auth",
      betterAuthUserId: input.betterAuthUserId,
      expiresAt: input.expiresAt,
      fresh: input.fresh,
    },
  });
}

export async function getAccountResponseForWidgetSession(input: {
  userId: string;
  expiresAt: Date | string | number;
  authMethod: string;
}): Promise<AomiAccountResponse> {
  const user = await findAomiUserById(input.userId);
  if (!user) {
    return { user: null, linkedAccounts: [], wallets: [], session: null };
  }
  return buildAccountResponse({
    user,
    session: {
      carrier: "widget",
      expiresAt: widgetSessionExpiresAtMillis(input.expiresAt),
      authMethod: input.authMethod,
    },
  });
}

// Widget sessions carry `expiresAt` as epoch seconds (see `issueWidgetSession`).
// Normalize to the milliseconds the account response emits before it reaches
// `buildAccountResponse`, which treats numbers as already-millis.
function widgetSessionExpiresAtMillis(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function syncSiweWalletsForUser(input: {
  aomiUserId: AomiUserId;
  betterAuthUserId: string;
  walletApp?: string;
  walletAppAddress?: string;
}): Promise<void> {
  await recordWalletApp("evm", input);
}

export async function syncSiwsWalletsForUser(input: {
  aomiUserId: AomiUserId;
  betterAuthUserId: string;
  walletApp?: string;
  walletAppAddress?: string;
}): Promise<void> {
  await recordWalletApp("svm", input);
}

async function recordWalletApp(
  family: WalletFamily,
  input: {
    aomiUserId: AomiUserId;
    walletApp?: string;
    walletAppAddress?: string;
  },
): Promise<void> {
  if (!input.walletApp || !input.walletAppAddress) return;
  // Metadata may update a canonical wallet, never recreate one from BA rows.
  await getPool().query(
    `update public_keys set authorization_metadata = authorization_metadata || $4::jsonb,
       updated_at = extract(epoch from now())::bigint
     where user_id = $1 and chain_type = $2 and address = $3`,
    [
      input.aomiUserId,
      family,
      normalizeWalletAddress(family, input.walletAppAddress),
      JSON.stringify({ wallet_app: input.walletApp }),
    ],
  );
}

export async function syncBetterAuthWalletsForUser(input: {
  aomiUserId: AomiUserId;
  betterAuthUserId: string;
}): Promise<void> {
  await Promise.all([
    syncSiweWalletsForUser(input),
    syncSiwsWalletsForUser(input),
  ]);
}

export async function resolveSignal(input: {
  currentUserId: AomiUserId;
  signal: SignalRef;
  db?: import("pg").Pool | import("pg").PoolClient;
}): Promise<SignalResolution> {
  await ensureAccountSchema();
  const ownerId = await findSignalOwner(input.signal, input.db);
  if (!ownerId) return { status: "linked" };
  if (ownerId === input.currentUserId) return { status: "noop" };

  await logAccountEvent({
    userId: input.currentUserId,
    actorUserId: input.currentUserId,
    eventType: signalEventType(input.signal, "conflict"),
    data: { signal: input.signal },
    db: input.db,
  });
  return {
    status: "conflict",
    reason: "already_linked_to_another_account",
    signalType: input.signal.type,
    owner: ownerId,
    signal: input.signal,
  };
}

export async function upsertVerifiedWallet(input: {
  userId: AomiUserId;
  family: WalletFamily;
  address: string;
  chainId?: number;
  chainScope?: string | null;
  kind: WalletKind;
  provider?: string | null;
  providerSubject?: string | null;
  providerWalletId?: string | null;
  linkedVia: LinkedVia;
  label?: string | null;
  walletApp?: string | null;
  db?: import("pg").Pool | import("pg").PoolClient;
}): Promise<SignalResolution> {
  await ensureAccountSchema();
  const signal = {
    type: "wallet" as const,
    family: input.family,
    normalizedAddress: normalizeWalletAddress(input.family, input.address),
    chainScope: input.chainScope ?? null,
  };
  if (!input.db) {
    return withTransaction(async (db) => {
      const walletSubject = walletIdentitySubject(input);
      await lockSignalRefs(
        [
          signal,
          ...(walletSubject
            ? [
                {
                  type: "identity" as const,
                  provider: walletSubject.provider,
                  ...IDENTITY_SCOPES[walletSubject.provider],
                  subject: walletSubject.subject,
                },
              ]
            : []),
        ],
        db,
      );
      return upsertVerifiedWallet({ ...input, db });
    });
  }
  const resolution = await resolveSignal({
    currentUserId: input.userId,
    signal,
    db: input.db,
  });
  if (resolution.status === "conflict") return resolution;
  const walletSubject = walletIdentitySubject(input);
  const identityResolution = walletSubject
    ? await resolveSignal({
        currentUserId: input.userId,
        signal: {
          type: "identity",
          provider: walletSubject.provider,
          ...IDENTITY_SCOPES[walletSubject.provider],
          subject: walletSubject.subject,
        },
        db: input.db,
      })
    : null;
  if (identityResolution?.status === "conflict") {
    return identityResolution;
  }
  if (
    resolution.status === "noop" &&
    (!identityResolution || identityResolution.status === "noop")
  ) {
    // Already in this account; a sign-in still records the app it came from.
    if (input.walletApp) await upsertWallet(input);
    return { status: "noop" };
  }
  await upsertWallet(input);
  if (resolution.status !== "noop") {
    await logAccountEvent({
      userId: input.userId,
      eventType: "wallet.linked",
      data: {
        family: input.family,
        address: input.address,
        linkedVia: input.linkedVia,
      },
      db: input.db,
    });
  }
  if (walletSubject) {
    await upsertAuthIdentity({
      userId: input.userId,
      provider: walletSubject.provider,
      ...IDENTITY_SCOPES[walletSubject.provider],
      subject: walletSubject.subject,
      db: input.db,
    });
    if (identityResolution?.status !== "noop") {
      await logAccountEvent({
        userId: input.userId,
        eventType: "identity.linked",
        data: {
          provider: walletSubject.provider,
          subject: walletSubject.subject,
        },
        db: input.db,
      });
    }
  }
  if (resolution.status !== "noop") return resolution;
  return identityResolution?.status && identityResolution.status !== "noop"
    ? identityResolution
    : { status: "noop" };
}

type WalletSignInFamily = {
  family: WalletFamily;
  provider: "siwe" | "siws";
};

const SIWE_SIGN_IN: WalletSignInFamily = { family: "evm", provider: "siwe" };
const SIWS_SIGN_IN: WalletSignInFamily = { family: "svm", provider: "siws" };

async function getOrCreateAomiUserForWalletSignIn(
  config: WalletSignInFamily,
  input: {
    address: string;
    chainId: number | string;
    onResolved?: (user: DbAomiUser, db: PoolClient) => Promise<void>;
  },
): Promise<DbAomiUser> {
  const scope = IDENTITY_SCOPES[config.provider];
  const normalizedAddress = normalizeWalletAddress(
    config.family,
    input.address,
  );
  const walletSignal: SignalRef = {
    type: "wallet",
    family: config.family,
    normalizedAddress,
    chainScope: null,
  };
  const identitySignal: SignalRef & { type: "identity" } = {
    type: "identity",
    provider: config.provider,
    ...scope,
    subject: `${scope.issuerEnvironment}:*:${normalizedAddress}`,
  };
  return withTransaction(async (db) => {
    await lockSignalRefs([walletSignal, identitySignal], db);
    const owner = await findSignalOwner(walletSignal, db);
    const identityOwner = await findSignalOwner(identitySignal, db);
    // A stale login identity cannot override public_keys, including after unlink.
    if (identityOwner && identityOwner !== owner) {
      await revokeAuthIdentity({
        userId: identityOwner,
        ...identitySignal,
        db,
      });
    }
    const user = owner
      ? await findAomiUserById(owner, db)
      : await createAomiUser({ displayName: shortAddress(input.address), db });
    if (!user) throw new Error("identity_owner_not_active");
    await upsertAuthIdentity({ userId: user.id, ...identitySignal, db });
    if (!owner) {
      const wallet = await upsertVerifiedWallet({
        userId: user.id,
        family: config.family,
        address: input.address,
        chainId: config.family === "evm" ? Number(input.chainId) : undefined,
        chainScope: null,
        kind: "external",
        provider: config.provider,
        linkedVia: config.provider,
        db,
      });
      if (wallet.status === "conflict")
        throw new Error("conflicting_identity_owners");
    }
    await input.onResolved?.(user, db);
    return user;
  });
}

export function getOrCreateAomiUserForSiwe(input: {
  address: string;
  chainId: number;
  onResolved?: (user: DbAomiUser, db: PoolClient) => Promise<void>;
}): Promise<DbAomiUser> {
  return getOrCreateAomiUserForWalletSignIn(SIWE_SIGN_IN, input);
}

export function getOrCreateAomiUserForSiws(input: {
  address: string;
  chainId: string;
  onResolved?: (user: DbAomiUser, db: PoolClient) => Promise<void>;
}): Promise<DbAomiUser> {
  return getOrCreateAomiUserForWalletSignIn(SIWS_SIGN_IN, input);
}

export async function linkProviderIdentity(input: {
  userId: AomiUserId;
  provider: AuthIdentityProvider;
  issuerEnvironment: string;
  tenantId: string;
  subject: string;
  email?: string | null;
  emailVerified?: boolean;
  displayLabel?: string | null;
  providerMetadata?: Record<string, unknown>;
  db?: import("pg").Pool | import("pg").PoolClient;
}): Promise<SignalResolution> {
  const identitySignal = {
    type: "identity" as const,
    provider: input.provider,
    issuerEnvironment: input.issuerEnvironment,
    tenantId: input.tenantId,
    subject: input.subject,
  };
  const identityResolution = await resolveSignal({
    currentUserId: input.userId,
    signal: identitySignal,
    db: input.db,
  });
  if (identityResolution.status === "conflict") {
    return identityResolution;
  }

  if (input.email && input.emailVerified) {
    const emailResolution = await resolveSignal({
      currentUserId: input.userId,
      signal: { type: "email", email: input.email },
      db: input.db,
    });
    if (emailResolution.status === "conflict") {
      return emailResolution;
    }
    await upsertEmailIdentity({
      userId: input.userId,
      email: input.email,
      db: input.db,
    });
  }

  await upsertAuthIdentity(input);
  // A verified provider email is an authentication identity, not permission
  // to overwrite the canonical display name. Profile changes are explicit and
  // go through updateAccountProfile; keeping them out of login also prevents a
  // historical users.username collision from aborting provider exchange.
  if (identityResolution.status !== "noop") {
    await logAccountEvent({
      userId: input.userId,
      eventType: "identity.linked",
      data: { provider: input.provider, subject: input.subject },
      db: input.db,
    });
  }
  return identityResolution.status === "noop"
    ? { status: "noop" }
    : identityResolution;
}

/** Sync embedded wallets a provider attests for the user into canonical
 *  `public_keys` rows. Server-side attestation replaces a SIWE/SIWS
 *  signature for custodied embedded wallets (and is the only SVM ownership
 *  proof available today).
 *
 *  On success: upserts every attested wallet as `kind='embedded'`,
 *  `linked_via=provider`, and soft-revokes any previously-linked embedded
 *  wallet from the same provider that the provider no longer attests
 *  (reconciliation). Only touches `kind='embedded'` rows for this provider —
 *  SIWE external wallets and the other provider's embedded wallets are
 *  never touched.
 *
 *  On fetch failure: logs and returns without revoking anything, so a
 *  transient provider API outage can't wipe a user's wallet graph. */
export async function syncProviderWallets(input: {
  userId: AomiUserId;
  provider: AttestedWalletProvider;
  issuerEnvironment: string;
  tenantId: string;
  subject?: string | null;
  attested: AttestedWallet[];
  db?: import("pg").Pool | import("pg").PoolClient;
}): Promise<SignalResolution> {
  if (!input.db) {
    return withTransaction(async (db) => {
      await lockSignalRefs(
        [
          ...(input.subject
            ? [
                {
                  type: "identity" as const,
                  provider: input.provider,
                  issuerEnvironment: input.issuerEnvironment,
                  tenantId: input.tenantId,
                  subject: input.subject,
                },
              ]
            : []),
          ...input.attested.map((wallet) => ({
            type: "wallet" as const,
            family: wallet.family,
            normalizedAddress: normalizeWalletAddress(
              wallet.family,
              wallet.address,
            ),
            chainScope: wallet.chainScope,
          })),
        ],
        db,
      );
      return syncProviderWallets({ ...input, db });
    });
  }
  const keepKeys = new Set(
    input.attested.map((w) => walletKeyString(w.family, w.address)),
  );

  for (const wallet of input.attested) {
    const resolution = await resolveSignal({
      currentUserId: input.userId,
      signal: {
        type: "wallet",
        family: wallet.family,
        normalizedAddress: normalizeWalletAddress(
          wallet.family,
          wallet.address,
        ),
        chainScope: wallet.chainScope,
      },
      db: input.db,
    });
    if (resolution.status === "conflict") {
      await logAccountEvent({
        userId: input.userId,
        eventType: "wallet.link_conflict",
        data: {
          family: wallet.family,
          address: wallet.address,
          provider: wallet.provider,
        },
        db: input.db,
      });
      return resolution;
    }
  }

  // 1. Upsert every attested wallet. A cross-account collision on one
  //    address must fail the provider exchange so the provider identity and
  //    its child wallet graph cannot drift apart.
  for (const wallet of input.attested) {
    try {
      await upsertWallet({
        userId: input.userId,
        family: wallet.family,
        address: wallet.address,
        chainScope: wallet.chainScope,
        kind: "embedded",
        provider: input.provider,
        providerSubject: input.subject,
        providerIssuerEnvironment: input.issuerEnvironment,
        providerTenantId: input.tenantId,
        providerWalletId: wallet.providerWalletId,
        linkedVia: input.provider,
        db: input.db,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "wallet_already_linked_to_another_account") {
        await logAccountEvent({
          userId: input.userId,
          eventType: "wallet.link_conflict",
          data: {
            family: wallet.family,
            address: wallet.address,
            provider: wallet.provider,
          },
          db: input.db,
        });
        return {
          status: "conflict",
          reason: "already_linked_to_another_account",
          signalType: "wallet",
        };
      }
      throw error;
    }
  }

  // 2. Reconcile: soft-revoke embedded wallets from this provider that the
  //    provider no longer attests.
  const existing = await listWalletsForUser(input.userId, input.db);
  for (const wallet of existing) {
    if (wallet.kind !== "embedded") continue;
    if (wallet.provider !== input.provider) continue;
    if (keepKeys.has(walletKeyString(wallet.family, wallet.address))) continue;
    const revoked = await revokeWallet({
      userId: input.userId,
      walletId: wallet.id,
      db: input.db,
    });
    if (revoked) {
      await logAccountEvent({
        userId: input.userId,
        eventType: "wallet.unlinked",
        data: {
          family: wallet.family,
          address: wallet.address,
          provider: wallet.provider,
          reason: "provider_no_longer_attests",
        },
        db: input.db,
      });
    }
  }

  return input.attested.length > 0 ? { status: "linked" } : { status: "noop" };
}

/** Outcome of a server-side attested-wallet lookup. The three cases are kept
 *  apart because they mean different things to a caller that requires a hosted
 *  wallet: `attested` is the provider's answer (an empty list is an answer —
 *  this user owns no embedded wallet), while `unconfigured` and `unavailable`
 *  mean no answer was obtained at all and nothing may be inferred from them. */
export type AttestedProviderWallets =
  | { status: "attested"; wallets: AttestedWallet[] }
  | { status: "unconfigured" }
  | { status: "unavailable"; error: unknown };

/** Ask the provider's server-side API which embedded wallets it attests for a
 *  verified subject. This is the only trusted source of provider wallet
 *  ownership: wallet arrays inside a provider session token are self-asserted
 *  client claims and never reach this path. */
export async function resolveAttestedProviderWallets(input: {
  provider: AttestedWalletProvider;
  /** Verified token subject: `did:privy:…` for Privy, Para user id for Para. */
  subject: string;
  email?: string | null;
  /** The provider-native login handle the token attests, when it carries one.
   *  Para's wallet API is keyed by it rather than by the subject. */
  loginIdentifier?: ProviderLoginIdentifier | null;
  attesters?: WalletAttesterRegistry;
  logger?: WalletAttestationLogger;
}): Promise<AttestedProviderWallets> {
  const attester = (input.attesters ?? createDefaultWalletAttesters())[
    input.provider
  ];
  if (!attester) return { status: "unconfigured" };
  try {
    const wallets = await attester({
      subject: input.subject,
      email: input.email,
      loginIdentifier: input.loginIdentifier,
    });
    if (!wallets) return { status: "unavailable", error: null };
    return {
      status: "attested",
      wallets: wallets.map((wallet) => ({
        ...wallet,
        provider: input.provider,
      })),
    };
  } catch (error) {
    observeAccountInternalFailure({ kind: "provider_wallets", error });
    input.logger?.warn(
      `syncProviderWallets: failed to list ${input.provider} wallets for ${input.subject}`,
      error,
    );
    return { status: "unavailable", error };
  }
}

/** Fetch attested embedded wallets for a verified provider subject using the
 *  server-side provider API. Returns `null` when the provider's REST
 *  credentials aren't configured (graceful degradation: callers fall back to
 *  identity-only behavior) or when the fetch fails (so the caller can skip
 *  the sync without revoking live rows). Callers that must not confuse those
 *  two with "the provider attests no wallet" use
 *  {@link resolveAttestedProviderWallets} instead. */
export async function fetchAttestedProviderWallets(input: {
  provider: AttestedWalletProvider;
  /** Verified token subject: `did:privy:…` for Privy, Para user id for Para. */
  subject: string;
  email?: string | null;
  loginIdentifier?: ProviderLoginIdentifier | null;
  attesters?: WalletAttesterRegistry;
  logger?: WalletAttestationLogger;
}): Promise<AttestedWallet[] | null> {
  const resolution = await resolveAttestedProviderWallets(input);
  return resolution.status === "attested" ? resolution.wallets : null;
}

/** Best-effort embedded-wallet sync after a successful provider identity link.
 * No-ops when provider REST credentials are unconfigured or the provider fetch
 * fails; existing wallet rows are only reconciled after a successful fetch. */
export async function syncProviderAttestedWallets(input: {
  userId: AomiUserId;
  provider: AttestedWalletProvider;
  issuerEnvironment: string;
  tenantId: string;
  subject: string;
  email?: string | null;
  db?: import("pg").Pool | import("pg").PoolClient;
  attesters?: WalletAttesterRegistry;
  logger?: WalletAttestationLogger;
  fallbackAttested?: readonly AttestedWallet[];
}): Promise<SignalResolution> {
  const fetched = await fetchAttestedProviderWallets({
    provider: input.provider,
    subject: input.subject,
    email: input.email,
    attesters: input.attesters,
    logger: input.logger,
  });
  const wallets = mergeProviderWalletAttestations(
    fetched ?? [],
    input.fallbackAttested ?? [],
  );
  if (!wallets.length) return { status: "noop" };
  return syncProviderWallets({
    userId: input.userId,
    provider: input.provider,
    issuerEnvironment: input.issuerEnvironment,
    tenantId: input.tenantId,
    subject: input.subject,
    attested: wallets,
    db: input.db,
  });
}

export function mergeProviderWalletAttestations(
  primary: readonly AttestedWallet[],
  fallback: readonly AttestedWallet[],
): AttestedWallet[] {
  const wallets: AttestedWallet[] = [];
  const seen = new Set<string>();
  for (const wallet of [...primary, ...fallback]) {
    const key = walletKeyString(wallet.family, wallet.address);
    if (seen.has(key)) continue;
    seen.add(key);
    wallets.push(wallet);
  }
  return wallets;
}

function walletKeyString(family: WalletFamily, address: string): string {
  return `${family}:${normalizeWalletAddress(family, address)}`;
}

export async function unlinkAuthIdentity(input: {
  userId: AomiUserId;
  identityId: string;
}): Promise<"revoked" | "not_found" | "last_factor" | "protected"> {
  const result = await withTransaction(async (db) => {
    await lockIdentityResolutionKeys(
      [`aomi-login-factors:${input.userId}`],
      db,
    );
    const identity = await findAuthIdentityById(input.identityId, db);
    if (!identity || identity.userId !== input.userId) {
      return { status: "not_found" as const };
    }
    if (
      identity.provider === "better_auth" ||
      identity.provider === "siwe" ||
      identity.provider === "siws" ||
      identity.provider === "email"
    ) {
      return { status: "protected" as const };
    }
    const factorCount = await countLoginFactors(input.userId, db);
    if (factorCount <= 1) return { status: "last_factor" as const };
    const revoked = await revokeAuthIdentity({
      userId: input.userId,
      provider: identity.provider,
      issuerEnvironment: identity.issuerEnvironment,
      tenantId: identity.tenantId,
      subject: identity.subject,
      db,
    });
    return revoked
      ? { status: "revoked" as const, identity }
      : { status: "not_found" as const };
  });
  if (result.status !== "revoked") return result.status;
  await deleteWidgetSessionsForProviderIdentity({
    providerIdentityId: result.identity.id,
  });
  await logAccountEvent({
    userId: input.userId,
    eventType: "identity.revoked",
    data: {
      identityId: input.identityId,
      provider: result.identity.provider,
    },
  });
  return "revoked";
}

export async function renameAuthIdentity(input: {
  userId: AomiUserId;
  identityId: string;
  displayLabel: string | null;
}): Promise<"updated" | "not_found" | "protected"> {
  const identity = await findAuthIdentityById(input.identityId);
  if (!identity || identity.userId !== input.userId) return "not_found";
  if (
    identity.provider === "better_auth" ||
    identity.provider === "siwe" ||
    identity.provider === "siws" ||
    identity.provider === "email"
  ) {
    return "protected";
  }
  const label = sanitizeLabel(input.displayLabel);
  const updated = await updateAuthIdentityLabel({
    userId: input.userId,
    identityId: input.identityId,
    displayLabel: label,
  });
  if (!updated) return "not_found";
  await logAccountEvent({
    userId: input.userId,
    eventType: "identity.label_updated",
    data: { identityId: input.identityId, label },
  });
  return "updated";
}

export async function renameWallet(input: {
  userId: AomiUserId;
  walletId: string;
  label: string | null;
}): Promise<boolean> {
  const label = sanitizeLabel(input.label);
  const wallet = await updateWalletLabel({
    userId: input.userId,
    walletId: input.walletId,
    label,
  });
  if (!wallet) return false;
  await logAccountEvent({
    userId: input.userId,
    eventType: "wallet.label_updated",
    data: { walletId: input.walletId, label },
  });
  return true;
}

export async function unlinkWallet(input: {
  userId: AomiUserId;
  walletId: string;
  betterAuthUserId?: string | null;
}): Promise<"revoked" | "not_found" | "last_factor"> {
  const status = await withTransaction(async (db) => {
    await lockIdentityResolutionKeys(
      [`aomi-login-factors:${input.userId}`],
      db,
    );
    const wallet = await findWalletById(input.walletId, db);
    if (!wallet || wallet.userId !== input.userId) return "not_found" as const;
    const provider = wallet.family === "evm" ? "siwe" : "siws";
    await lockSignalRefs(
      [
        {
          type: "wallet",
          family: wallet.family,
          normalizedAddress: normalizeWalletAddress(
            wallet.family,
            wallet.address,
          ),
          chainScope: null,
        },
        {
          type: "identity",
          provider,
          ...IDENTITY_SCOPES[provider],
          subject: `${IDENTITY_SCOPES[provider].issuerEnvironment}:*:${normalizeWalletAddress(wallet.family, wallet.address)}`,
        },
      ],
      db,
    );
    const factorCount = await countLoginFactors(input.userId, db);
    if (factorCount <= 1) return "last_factor" as const;
    const revoked = await revokeWallet({ ...input, db });
    if (!revoked) return "not_found" as const;
    const subject =
      wallet.family === "evm"
        ? `eip155:*:${normalizeWalletAddress("evm", wallet.address)}`
        : siwsIdentitySubject(wallet.address);
    await revokeAuthIdentity({
      userId: input.userId,
      provider,
      ...IDENTITY_SCOPES[provider],
      subject,
      db,
    });
    if (wallet.family === "evm") {
      await deleteBetterAuthSiweWallet({ address: wallet.address, db });
    } else {
      await deleteBetterAuthSiwsWallet({ address: wallet.address, db });
    }
    // A Better Auth user can carry other login methods and live sessions.
    // Removing one wallet must not detach its account mapping.
    return "revoked" as const;
  });
  if (status !== "revoked") return status;
  await logAccountEvent({
    userId: input.userId,
    eventType: "wallet.revoked",
    data: { walletId: input.walletId },
  });
  return "revoked";
}

export async function updateAccountProfile(input: {
  userId: AomiUserId;
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<void> {
  await updateAomiUserProfile({
    userId: input.userId,
    displayName:
      input.displayName === undefined
        ? undefined
        : sanitizeDisplayName(input.displayName),
    avatarUrl: input.avatarUrl,
  });
  await logAccountEvent({
    userId: input.userId,
    eventType: "account.profile_updated",
    data: {
      displayName: input.displayName === undefined ? undefined : "[updated]",
      avatarUrl: input.avatarUrl ? "[updated]" : null,
    },
  });
}

export type DeactivateAomiAccountResult =
  | {
      status: "deactivated";
      revokedIdentities: number;
      revokedWallets: number;
    }
  | { status: "not_found" };

export async function deactivateAomiAccount(input: {
  userId: AomiUserId;
}): Promise<DeactivateAomiAccountResult> {
  await ensureAccountSchema();
  return withTransaction(async (db) => {
    const user = await findAomiUserById(input.userId, db);
    if (!user) return { status: "not_found" };
    // Last-factor protection guards *unlinking* an individual identity/wallet
    // (see `unlinkAuthIdentity`/`unlinkWallet`), not full account deletion.
    // Deleting an account is meant to revoke every remaining factor, so a
    // Para-only/SIWE-only single-factor user must still be able to delete.

    const revokedIdentities = await revokeAllAuthIdentitiesForUser({
      userId: input.userId,
      db,
    });
    const revokedWallets = await revokeAllWalletsForUser({
      userId: input.userId,
      db,
    });
    const deactivated = await deactivateAomiUser({
      userId: input.userId,
      db,
    });
    if (!deactivated) return { status: "not_found" };

    await logAccountEvent({
      userId: input.userId,
      actorUserId: input.userId,
      eventType: "account.deactivated",
      data: {
        revokedIdentities,
        revokedWallets,
        hadBetterAuthUserId: Boolean(user.betterAuthUserId),
      },
      db,
    });
    return {
      status: "deactivated",
      revokedIdentities,
      revokedWallets,
    };
  });
}

function signalEventType(signal: SignalRef, suffix: string): string {
  if (signal.type === "wallet") return `wallet.${suffix}`;
  if (signal.type === "email") return `email.${suffix}`;
  return `identity.${suffix}`;
}

function walletIdentitySubject(input: {
  family: WalletFamily;
  address: string;
  linkedVia: LinkedVia;
}): { provider: "siwe" | "siws"; subject: string } | null {
  if (input.family === "evm" && input.linkedVia === "siwe") {
    return {
      provider: "siwe",
      subject: `eip155:*:${normalizeWalletAddress("evm", input.address)}`,
    };
  }
  if (input.family === "svm" && input.linkedVia === "siws") {
    return {
      provider: "siws",
      subject: siwsIdentitySubject(input.address),
    };
  }
  return null;
}

function siwsIdentitySubject(address: string): string {
  return `solana:*:${normalizeWalletAddress("svm", address)}`;
}

function sanitizeLabel(value: string | null): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

function sanitizeDisplayName(value: string | null): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}
