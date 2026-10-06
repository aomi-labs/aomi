import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "./pool";
import {
  IDENTITY_SCOPES,
  type AccountWallet,
  type AomiAccountResponse,
  type AomiUserId,
  type AuthIdentityProvider,
  type DbAomiAuthIdentity,
  type DbAomiUser,
  type DbAomiWallet,
  type LinkedAuthAccount,
  type LinkedVia,
  type SignalRef,
  type WalletFamily,
  type WalletKind,
} from "../types";
import { normalizeWalletAddress } from "../service/wallet-normalization";

type Db = Pool | PoolClient;
type Row = Record<string, unknown>;

const BETTER_AUTH_PROVIDER = "betterauth";

export async function runAomiAuthSchema(_db: Db = getPool()): Promise<void> {
  // AUTH-001: account-link state lives in the backend canonical schema
  // (`users`, `auth_providers`, `public_keys`). BetterAuth creates its own
  // session tables; db-master/product-mono migrations create the canonical graph.
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  db: Pool = getPool(),
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function findAomiUserById(
  userId: AomiUserId,
  db: Db = getPool(),
): Promise<DbAomiUser | null> {
  const result = await db.query(
    `select * from users
      where id = $1 and coalesce(status, 'active') = 'active'
      limit 1`,
    [userId],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

/** Resolve the verified Telegram identity and claim an unowned runtime session
 * for that same canonical user. A session already owned by anyone else is
 * rejected, preventing a valid Telegram launch from crossing accounts. */
export async function claimTelegramSessionOwner(input: {
  sessionId: string;
  telegramUserId: string;
  db?: Db;
}): Promise<AomiUserId | null> {
  const db = input.db ?? getPool();
  const result = await db.query(
    `with telegram_owner as (
       select ap.user_id
         from auth_providers ap
         join users u on u.id = ap.user_id
        where ap.provider = 'telegram'
          and ap.issuer_environment = 'aomi'
          and ap.tenant_id = 'global'
          and ap.subject = $2
          and coalesce(u.status, 'active') = 'active'
        limit 1
     ), claimed as (
       update threads t
          set user_id = owner.user_id
         from telegram_owner owner
        where t.id = $1
          and (t.user_id is null or t.user_id = owner.user_id)
       returning t.user_id
     )
     select user_id from claimed`,
    [input.sessionId, input.telegramUserId],
  );
  const userId = result.rows[0]?.user_id;
  return typeof userId === "string" ? userId : null;
}

export async function createAomiUser(input: {
  userId?: AomiUserId;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  displayName?: string | null;
  db?: Db;
}): Promise<DbAomiUser> {
  const db = input.db ?? getPool();
  const userId = input.userId ?? randomUUID();
  const now = nowSeconds();
  const username = await resolveAvailableUsername(
    db,
    input.displayName ?? input.name ?? deriveDisplayName(input.email),
    userId,
  );
  const result = await db.query(
    `insert into users (id, username, created_at, updated_at)
     values ($1, $2, $3, $3)
     on conflict (id) do update set
       username = coalesce(users.username, excluded.username),
       updated_at = excluded.updated_at
     returning *`,
    [userId, username, now],
  );
  return mapUser(result.rows[0]);
}

// `users.username` is a unique column, and the handle we derive from a
// provider's claimed name/email can already be held by another canonical user
// — including a handle a third party seeded first to grief a login. A bare
// insert would then raise 23505 and burn the identity-resolution retry loop
// into a login 500. Pick the first free handle deterministically (the base,
// then `base-<stable suffix>` variants derived from the new user id) so account
// creation never fails on username contention. A rare check-then-insert race
// still surfaces as 23505, which the caller's transaction retry re-runs; the
// re-run sees the handle taken and advances to a suffixed variant.
async function resolveAvailableUsername(
  db: Db,
  base: string | null,
  userId: string,
): Promise<string | null> {
  if (!base) return null;
  if (!(await usernameExists(db, base))) return base;
  const seed = userId.replace(/-/g, "");
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${base}-${seed.slice(0, 6 + attempt)}`;
    if (!(await usernameExists(db, candidate))) return candidate;
  }
  return `${base}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function usernameExists(db: Db, username: string): Promise<boolean> {
  const result = await db.query(
    `select 1 from users where username = $1 limit 1`,
    [username],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function lockIdentityResolutionKeys(
  keys: readonly string[],
  db: Db,
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      key,
    ]);
  }
}

export async function listBetterAuthSiwsWallets(
  betterAuthUserId: string,
  db: Db = getPool(),
): Promise<
  Array<{
    betterAuthUserId: string;
    address: string;
    createdAt: Date;
  }>
> {
  try {
    const result = await db.query(
      `select user_id as better_auth_user_id,
              account_id as address,
              created_at
         from ba_accounts
        where user_id = $1
          and provider_id = 'siws'`,
      [betterAuthUserId],
    );
    return result.rows.map((row) => ({
      betterAuthUserId: String(row.better_auth_user_id),
      address: String(row.address),
      createdAt: new Date(row.created_at as string | Date),
    }));
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    return [];
  }
}

export async function touchAomiUser(
  userId: AomiUserId,
  db: Db = getPool(),
): Promise<void> {
  await db.query("update users set updated_at = $2 where id = $1", [
    userId,
    nowSeconds(),
  ]);
}

export async function logAccountEvent(_input?: {
  userId?: AomiUserId | null;
  actorUserId?: AomiUserId | null;
  eventType: string;
  data?: Record<string, unknown>;
  db?: Db;
}): Promise<void> {
  // There is no canonical account-events table in the backend graph yet.
}

export async function findSignalOwner(
  signal: SignalRef,
  db: Db = getPool(),
): Promise<AomiUserId | null> {
  if (signal.type === "wallet") {
    const result = await db.query(
      `select pk.user_id
         from public_keys pk
         join users u on u.id = pk.user_id
        where pk.chain_type = $1
          and pk.address = $2
          and coalesce(u.status, 'active') = 'active'
        limit 1`,
      [
        canonicalChainType(signal.family),
        canonicalAddress(signal.family, signal.normalizedAddress),
      ],
    );
    return (result.rows[0]?.user_id as string | undefined) ?? null;
  }
  if (signal.type === "identity") {
    const result = await db.query(
      `select ap.user_id
         from auth_providers ap
         join users u on u.id = ap.user_id
        where ap.provider = $1
          and ap.issuer_environment = $2
          and ap.tenant_id = $3
          and ap.subject = $4
          and coalesce(u.status, 'active') = 'active'
        limit 1`,
      [
        canonicalProvider(signal.provider),
        signal.issuerEnvironment,
        signal.tenantId,
        signal.subject,
      ],
    );
    return (result.rows[0]?.user_id as string | undefined) ?? null;
  }
  const result = await db.query(
    `select ap.user_id
       from auth_providers ap
       join users u on u.id = ap.user_id
      where ap.method = 'email'
        and lower(ap.value) = lower($1)
        and ap.verified_at is not null
        and coalesce(u.status, 'active') = 'active'
      limit 1`,
    [signal.email],
  );
  return (result.rows[0]?.user_id as string | undefined) ?? null;
}

export async function findProviderSubjectOwners(
  provider: AuthIdentityProvider,
  issuerEnvironment: string,
  subject: string,
  db: Db = getPool(),
): Promise<AomiUserId[]> {
  const result = await db.query(
    `select distinct ap.user_id
       from auth_providers ap
       join users u on u.id = ap.user_id
      where ap.provider = $1
        and ap.issuer_environment = $2
        and ap.subject = $3
        and coalesce(u.status, 'active') = 'active'
      order by ap.user_id`,
    [canonicalProvider(provider), issuerEnvironment, subject],
  );
  return result.rows.map((row) => String(row.user_id));
}

export async function countLoginFactors(
  userId: AomiUserId,
  db: Db = getPool(),
): Promise<number> {
  const result = await db.query(
    `select count(*)::int as count
       from auth_providers
      where user_id = $1
        and provider not in ('betterauth', 'better_auth', 'wallet')`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function upsertAuthIdentity(input: {
  userId: AomiUserId;
  provider: AuthIdentityProvider;
  issuerEnvironment: string;
  tenantId: string;
  subject: string;
  email?: string | null;
  displayLabel?: string | null;
  providerMetadata?: Record<string, unknown>;
  db?: Db;
}): Promise<DbAomiAuthIdentity> {
  const db = input.db ?? getPool();
  const provider = canonicalProvider(input.provider);
  const now = nowSeconds();
  const metadata = {
    ...(input.providerMetadata ?? {}),
    ...(input.displayLabel ? { display_label: input.displayLabel } : {}),
    ...(input.email ? { email: input.email } : {}),
  };
  const method = provider === "email" ? "email" : provider;
  const value =
    provider === "email" ? (input.email ?? input.subject) : input.subject;
  const result = await db.query(
    `insert into auth_providers
       (user_id, provider, issuer_environment, tenant_id, subject, method,
        value, verified_at, is_primary, provider_metadata, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11)
     on conflict (provider, issuer_environment, tenant_id, subject)
       where subject is not null
     do update set
       value = excluded.value,
       verified_at = coalesce(auth_providers.verified_at, excluded.verified_at),
       is_primary = auth_providers.is_primary or excluded.is_primary,
       provider_metadata = auth_providers.provider_metadata || excluded.provider_metadata,
       updated_at = excluded.updated_at
     where auth_providers.user_id = excluded.user_id
     returning *`,
    [
      input.userId,
      provider,
      input.issuerEnvironment,
      input.tenantId,
      input.subject,
      method,
      value.trim(),
      now,
      provider === BETTER_AUTH_PROVIDER,
      JSON.stringify(metadata),
      now,
    ],
  );
  if (!result.rows[0]) {
    throw new Error("identity_already_linked_to_another_account");
  }
  return mapIdentity(result.rows[0]);
}

export async function upsertEmailIdentity(input: {
  userId: AomiUserId;
  email: string;
  db?: Db;
}): Promise<DbAomiAuthIdentity> {
  return upsertAuthIdentity({
    userId: input.userId,
    provider: "email",
    ...IDENTITY_SCOPES.email,
    subject: input.email.toLowerCase(),
    email: input.email,
    db: input.db,
  });
}

export async function revokeAuthIdentity(input: {
  userId: AomiUserId;
  provider: AuthIdentityProvider;
  issuerEnvironment: string;
  tenantId: string;
  subject: string;
  db?: Db;
}): Promise<boolean> {
  const db = input.db ?? getPool();
  const identity = await db.query(
    `select id from auth_providers
      where user_id = $1 and provider = $2
        and issuer_environment = $3 and tenant_id = $4 and subject = $5
      limit 1`,
    [
      input.userId,
      canonicalProvider(input.provider),
      input.issuerEnvironment,
      input.tenantId,
      input.subject,
    ],
  );
  const identityId = identity.rows[0]?.id;
  if (identityId != null) {
    await db.query(`delete from public_keys where auth_provider_id = $1`, [
      Number(identityId),
    ]);
  }
  const result = await db.query(
    `delete from auth_providers
      where user_id = $1 and provider = $2
        and issuer_environment = $3 and tenant_id = $4 and subject = $5`,
    [
      input.userId,
      canonicalProvider(input.provider),
      input.issuerEnvironment,
      input.tenantId,
      input.subject,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function clearAomiBetterAuthUserIds(input: {
  userId: AomiUserId;
  betterAuthUserIds: readonly string[];
  db?: Db;
}): Promise<boolean> {
  if (input.betterAuthUserIds.length === 0) return false;
  const db = input.db ?? getPool();
  const result = await db.query(
    `delete from auth_providers
      where user_id = $1
        and provider = any($2::text[])
        and subject = any($3::text[])`,
    [
      input.userId,
      [BETTER_AUTH_PROVIDER, "better_auth"],
      [...input.betterAuthUserIds],
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function upsertWallet(input: {
  userId: AomiUserId;
  family: WalletFamily;
  address: string;
  chainId?: number;
  chainScope?: string | null;
  kind: WalletKind;
  provider?: string | null;
  providerSubject?: string | null;
  providerIssuerEnvironment?: string | null;
  providerTenantId?: string | null;
  providerWalletId?: string | null;
  linkedVia: LinkedVia;
  label?: string | null;
  db?: Db;
}): Promise<DbAomiWallet> {
  const db = input.db ?? getPool();
  const chainType = canonicalChainType(input.family);
  const address = canonicalAddress(input.family, input.address);
  const authProvider = await resolveWalletAuthProvider(input, db);
  const now = nowSeconds();
  const walletMetadata =
    input.label !== undefined ? { display_label: input.label } : {};

  const result = await db.query(
    `insert into public_keys
       (chain_type, address, user_id, auth_provider_id, is_primary,
        authorization_metadata, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
     on conflict (chain_type, address)
     do update set
       user_id = excluded.user_id,
       auth_provider_id = excluded.auth_provider_id,
       is_primary = excluded.is_primary,
       -- A name the user already gave this address wins over one sent at link time.
       authorization_metadata =
         case
           when $6::jsonb ? 'display_label'
             and coalesce(public_keys.authorization_metadata->>'display_label', '') = ''
             then public_keys.authorization_metadata || $6::jsonb
           else public_keys.authorization_metadata
         end,
       updated_at = excluded.updated_at
     where public_keys.user_id = excluded.user_id
     returning *`,
    [
      chainType,
      address,
      input.userId,
      authProvider?.id ?? null,
      false,
      JSON.stringify(walletMetadata),
      now,
    ],
  );
  if (!result.rows[0]) {
    throw new Error("wallet_already_linked_to_another_account");
  }
  if (input.kind !== "external" && input.family === "evm") {
    const provider = canonicalProvider(input.provider ?? input.linkedVia);
    if (provider !== "siwe") {
      await db.query(
        `delete from auth_providers ap
          where ap.user_id = $1
            and ap.provider = 'siwe'
            and ap.subject = $2
            and not exists (
              select 1 from public_keys pk where pk.auth_provider_id = ap.id
            )`,
        [input.userId, siweSubject(input.address)],
      );
    }
  }
  return mapWallet(
    result.rows[0],
    authProvider?.provider ?? input.provider ?? null,
  );
}

export async function listIdentitiesForUser(
  userId: AomiUserId,
  db: Db = getPool(),
): Promise<DbAomiAuthIdentity[]> {
  const result = await db.query(
    `select * from auth_providers
      where user_id = $1
      order by is_primary desc, created_at asc`,
    [userId],
  );
  return result.rows.map(mapIdentity);
}

export async function listWalletsForUser(
  userId: AomiUserId,
  db: Db = getPool(),
): Promise<DbAomiWallet[]> {
  const result = await db.query(
    `select pk.*,
            ap.provider as wallet_provider,
            ap.provider_metadata as wallet_provider_metadata
       from public_keys pk
       left join auth_providers ap on ap.id = pk.auth_provider_id
      where pk.user_id = $1
      order by pk.is_primary desc, pk.created_at asc`,
    [userId],
  );
  return result.rows.map((row) =>
    mapWallet(row, (row.wallet_provider as string | undefined) ?? null),
  );
}

export async function updateAomiUserProfile(input: {
  userId: AomiUserId;
  displayName?: string | null;
  primaryEmail?: string | null;
  avatarUrl?: string | null;
  db?: Db;
}): Promise<DbAomiUser> {
  const db = input.db ?? getPool();
  const result = await db.query(
    `update users
        set username = coalesce($2, username),
            updated_at = $3
      where id = $1
      returning *`,
    [
      input.userId,
      input.displayName ?? input.primaryEmail ?? null,
      nowSeconds(),
    ],
  );
  return mapUser(result.rows[0]);
}

export async function deactivateAomiUser(input: {
  userId: AomiUserId;
  db?: Db;
}): Promise<DbAomiUser | null> {
  const db = input.db ?? getPool();
  const result = await db.query(
    `update users
        set status = 'deactivated', updated_at = $2
      where id = $1 and coalesce(status, 'active') = 'active'
      returning *`,
    [input.userId, nowSeconds()],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function findAuthIdentityById(
  identityId: string,
  db: Db = getPool(),
): Promise<DbAomiAuthIdentity | null> {
  const result = await db.query(
    `select * from auth_providers where id = $1 limit 1`,
    [Number(identityId)],
  );
  return result.rows[0] ? mapIdentity(result.rows[0]) : null;
}

export async function updateAuthIdentityLabel(input: {
  userId: AomiUserId;
  identityId: string;
  displayLabel: string | null;
  db?: Db;
}): Promise<DbAomiAuthIdentity | null> {
  const db = input.db ?? getPool();
  const result = await db.query(
    `update auth_providers
        set provider_metadata = provider_metadata || $3::jsonb,
            updated_at = $4
      where id = $1 and user_id = $2
      returning *`,
    [
      Number(input.identityId),
      input.userId,
      JSON.stringify({ display_label: input.displayLabel }),
      nowSeconds(),
    ],
  );
  return result.rows[0] ? mapIdentity(result.rows[0]) : null;
}

export async function updateWalletLabel(input: {
  userId: AomiUserId;
  walletId: string;
  label: string | null;
  db?: Db;
}): Promise<DbAomiWallet | null> {
  const db = input.db ?? getPool();
  await db.query(
    `update public_keys
        set authorization_metadata = authorization_metadata || $3::jsonb,
            updated_at = $4
      where id = $1 and user_id = $2`,
    [
      Number(input.walletId),
      input.userId,
      JSON.stringify({ display_label: input.label }),
      nowSeconds(),
    ],
  );
  const wallet = await findWalletById(input.walletId, db);
  if (!wallet || wallet.userId !== input.userId) return null;
  return wallet;
}

export async function revokeWallet(input: {
  userId: AomiUserId;
  walletId: string;
  db?: Db;
}): Promise<boolean> {
  const db = input.db ?? getPool();
  const result = await db.query(
    `delete from public_keys where id = $1 and user_id = $2`,
    [Number(input.walletId), input.userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeAllAuthIdentitiesForUser(input: {
  userId: AomiUserId;
  db?: Db;
}): Promise<number> {
  const db = input.db ?? getPool();
  await db.query(
    `delete from public_keys
      where auth_provider_id in (
        select id from auth_providers where user_id = $1
      )`,
    [input.userId],
  );
  const result = await db.query(
    `delete from auth_providers where user_id = $1`,
    [input.userId],
  );
  return result.rowCount ?? 0;
}

export async function revokeAllWalletsForUser(input: {
  userId: AomiUserId;
  db?: Db;
}): Promise<number> {
  const db = input.db ?? getPool();
  const result = await db.query(`delete from public_keys where user_id = $1`, [
    input.userId,
  ]);
  return result.rowCount ?? 0;
}

export async function findWalletById(
  walletId: string,
  db: Db = getPool(),
): Promise<DbAomiWallet | null> {
  const result = await db.query(
    `select pk.*,
            ap.provider as wallet_provider,
            ap.provider_metadata as wallet_provider_metadata
       from public_keys pk
       left join auth_providers ap on ap.id = pk.auth_provider_id
      where pk.id = $1
      limit 1`,
    [Number(walletId)],
  );
  return result.rows[0]
    ? mapWallet(
        result.rows[0],
        (result.rows[0].wallet_provider as string | undefined) ?? null,
      )
    : null;
}

export async function buildAccountResponse(input: {
  user: DbAomiUser;
  session:
    | {
        carrier: "better_auth";
        betterAuthUserId: string;
        expiresAt?: Date | string | number | null;
        fresh?: boolean;
      }
    | {
        carrier: "widget";
        expiresAt: Date | string | number;
        authMethod: string;
      };
  db?: Db;
}): Promise<AomiAccountResponse> {
  const [identities, wallets] = await Promise.all([
    listIdentitiesForUser(input.user.id, input.db),
    listWalletsForUser(input.user.id, input.db),
  ]);
  // A verified email is a separate login identity in the account graph. Older
  // profiles may have no primary_email even though that identity is linked.
  // Expose it on reads without changing the user's chosen display name.
  const verifiedEmail = identities
    .filter(
      (identity) =>
        identity.provider === "email" && identity.verifiedAt && identity.email,
    )
    .sort(
      (left, right) =>
        left.linkedAt.getTime() - right.linkedAt.getTime() ||
        left.id.localeCompare(right.id),
    )[0]?.email;
  return {
    user: {
      id: input.user.id,
      displayName: input.user.displayName ?? undefined,
      email: input.user.primaryEmail ?? verifiedEmail ?? undefined,
      avatarUrl: input.user.avatarUrl ?? undefined,
    },
    linkedAccounts: identities.map(toLinkedAccount),
    wallets: wallets.map(toAccountWallet),
    session:
      input.session.carrier === "better_auth"
        ? {
            carrier: "better_auth",
            betterAuthUserId: input.session.betterAuthUserId,
            expiresAt: toMillis(input.session.expiresAt),
            fresh: input.session.fresh,
          }
        : {
            carrier: "widget",
            expiresAt: toMillis(input.session.expiresAt) ?? 0,
            authMethod: input.session.authMethod,
          },
  };
}

export async function listBetterAuthSiweWallets(
  betterAuthUserId: string,
  db: Db = getPool(),
): Promise<
  Array<{
    betterAuthUserId: string;
    address: string;
    chainId: number;
    isPrimary: boolean;
    createdAt: Date;
  }>
> {
  try {
    const result = await db.query(
      `select user_id as better_auth_user_id,
              address,
              chain_id,
              is_primary,
              created_at
         from ba_wallet_addresses
        where user_id = $1`,
      [betterAuthUserId],
    );
    return result.rows.map((row) => ({
      betterAuthUserId: String(row.better_auth_user_id),
      address: String(row.address),
      chainId: Number(row.chain_id),
      isPrimary: Boolean(row.is_primary),
      createdAt: new Date(row.created_at as string | Date),
    }));
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    return [];
  }
}

export async function deleteBetterAuthSiweWallet(input: {
  address: string;
  chainId?: number | null;
  syntheticEmails?: readonly string[];
  db?: Db;
}): Promise<{ deleted: boolean; betterAuthUserIds: string[] }> {
  const db = input.db ?? getPool();
  const betterAuthUserIds = new Set<string>();
  let deletedCount = 0;

  try {
    const result = await db.query(
      `delete from ba_wallet_addresses
        where lower(address) = lower($1)
          and ($2::int is null or chain_id = $2)
        returning user_id as better_auth_user_id`,
      [input.address, input.chainId ?? null],
    );
    deletedCount += result.rowCount ?? 0;
    for (const row of result.rows) {
      betterAuthUserIds.add(String(row.better_auth_user_id));
    }
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
  }

  try {
    const result = await db.query(
      `delete from ba_accounts
        where provider_id = 'siwe'
          and lower(split_part(account_id, ':', 1)) = lower($1)
          and ($2::int is null or split_part(account_id, ':', 2) = $2::text)
        returning user_id as better_auth_user_id`,
      [input.address, input.chainId ?? null],
    );
    deletedCount += result.rowCount ?? 0;
    for (const row of result.rows) {
      betterAuthUserIds.add(String(row.better_auth_user_id));
    }
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
  }

  return {
    deleted: deletedCount > 0,
    betterAuthUserIds: [...betterAuthUserIds],
  };
}

export async function deleteBetterAuthSiwsWallet(input: {
  address: string;
  db?: Db;
}): Promise<{ deleted: boolean; betterAuthUserIds: string[] }> {
  const db = input.db ?? getPool();
  try {
    const result = await db.query(
      `delete from ba_accounts
        where provider_id = 'siws'
          and account_id = $1
        returning user_id as better_auth_user_id`,
      [input.address],
    );
    return {
      deleted: (result.rowCount ?? 0) > 0,
      betterAuthUserIds: result.rows.map((row) =>
        String(row.better_auth_user_id),
      ),
    };
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    return { deleted: false, betterAuthUserIds: [] };
  }
}

export type AccountMergePreview = {
  name: string | null;
  createdAt: Date;
  chats: number;
  wallets: number;
  creditsMicrousd: number;
  dropped: string[];
};

/** A read-only summary of `sourceUserId`, as merging it into the target would see it. */
export async function previewAccountMerge(input: {
  sourceUserId: AomiUserId;
  targetUserId: AomiUserId;
  db?: Db;
}): Promise<AccountMergePreview | null> {
  const result = await (input.db ?? getPool()).query(
    `select account_merge_preview($1, $2) as preview`,
    [input.sourceUserId, input.targetUserId],
  );
  const preview = asRecord(result.rows[0]?.preview);
  if (!("created_at" in preview)) return null;
  return {
    name: optionalString(preview.name),
    createdAt: secondsToDate(preview.created_at),
    chats: Number(preview.chats ?? 0),
    wallets: Number(preview.wallets ?? 0),
    creditsMicrousd: Number(preview.credits_microusd ?? 0),
    dropped: Array.isArray(preview.dropped) ? preview.dropped.map(String) : [],
  };
}

export async function insertAccountMergeTicket(input: {
  id: string;
  targetUserId: AomiUserId;
  sourceUserId: AomiUserId;
  credential: SignalRef;
  expiresAt: number;
  db?: Db;
}): Promise<void> {
  await (input.db ?? getPool()).query(
    `insert into account_merge_tickets
       (id, target_user_id, source_user_id, credential, created_at, expires_at)
     values ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      input.id,
      input.targetUserId,
      input.sourceUserId,
      JSON.stringify(input.credential),
      nowSeconds(),
      input.expiresAt,
    ],
  );
}

/** Consume a live ticket minted for `targetUserId`. */
export async function takeAccountMergeTicket(input: {
  id: string;
  targetUserId: AomiUserId;
  db: Db;
}): Promise<{ sourceUserId: AomiUserId; credential: SignalRef } | null> {
  const now = nowSeconds();
  const result = await input.db.query(
    `update account_merge_tickets
        set consumed_at = $3
      where id = $1 and target_user_id = $2
        and consumed_at is null and expires_at > $3
      returning source_user_id, credential`,
    [input.id, input.targetUserId, now],
  );
  const row = result.rows[0];
  return row
    ? {
        sourceUserId: String(row.source_user_id),
        credential: row.credential as SignalRef,
      }
    : null;
}

/** Runs `merge_accounts`; the caller owns the transaction. */
export async function mergeAccountRows(input: {
  sourceUserId: AomiUserId;
  targetUserId: AomiUserId;
  db: PoolClient;
}): Promise<{ chats: number; wallets: number; dropped: string[] }> {
  const result = await input.db.query(
    `select merge_accounts($1, $2) as merged`,
    [input.sourceUserId, input.targetUserId],
  );
  const merged = asRecord(result.rows[0]?.merged);
  return {
    chats: Number(merged.chats ?? 0),
    wallets: Number(merged.wallets ?? 0),
    dropped: Array.isArray(merged.dropped) ? merged.dropped.map(String) : [],
  };
}

/** The Better Auth users that sign in to this account, newest first. */
export async function listBetterAuthUserIds(
  userId: AomiUserId,
  db: Db = getPool(),
): Promise<string[]> {
  const result = await db.query(
    `select subject from auth_providers
      where user_id = $1 and provider = $2 and subject is not null
      order by updated_at desc, id desc`,
    [userId, BETTER_AUTH_PROVIDER],
  );
  return result.rows.map((row) => String(row.subject));
}

export async function deleteBetterAuthSessions(
  betterAuthUserIds: readonly string[],
  db: Db = getPool(),
): Promise<void> {
  if (!betterAuthUserIds.length) return;
  await db.query(`delete from ba_sessions where user_id = any($1::text[])`, [
    [...betterAuthUserIds],
  ]);
}

/** A short-lived single-use value in Better Auth's verification table. */
export async function storeVerification(input: {
  identifier: string;
  value: string;
  expiresAt: Date;
  db?: Db;
}): Promise<void> {
  await (input.db ?? getPool()).query(
    `insert into ba_verifications (id, identifier, value, expires_at)
     values ($1, $2, $3, $4)`,
    [randomUUID(), input.identifier, input.value, input.expiresAt],
  );
}

/** Deletes and returns a live verification value; null if missing or expired. */
export async function takeVerification(
  identifier: string,
  db: Db = getPool(),
): Promise<string | null> {
  const result = await db.query(
    `delete from ba_verifications
      where identifier = $1
      returning value, expires_at`,
    [identifier],
  );
  const row = result.rows[0];
  if (!row || new Date(row.expires_at as string | Date) <= new Date()) {
    return null;
  }
  return String(row.value);
}

async function resolveWalletAuthProvider(
  input: {
    userId: AomiUserId;
    family: WalletFamily;
    address: string;
    provider?: string | null;
    providerSubject?: string | null;
    providerIssuerEnvironment?: string | null;
    providerTenantId?: string | null;
    label?: string | null;
    linkedVia: LinkedVia;
  },
  db: Db,
): Promise<{ id: number; provider: string } | null> {
  const provider = canonicalProvider(input.provider ?? input.linkedVia);
  if (!provider || provider === "import" || provider === "observed") {
    return null;
  }
  const subject =
    input.providerSubject ??
    (provider === "siwe" && input.family === "evm"
      ? siweSubject(input.address)
      : provider === "siws" && input.family === "svm"
        ? siwsSubject(input.address)
        : null);
  if (subject) {
    const staticScope =
      provider === "siwe"
        ? IDENTITY_SCOPES.siwe
        : provider === "siws"
          ? IDENTITY_SCOPES.siws
          : null;
    const issuerEnvironment =
      input.providerIssuerEnvironment ?? staticScope?.issuerEnvironment;
    const tenantId = input.providerTenantId ?? staticScope?.tenantId;
    if (!issuerEnvironment || !tenantId) {
      throw new Error(`Provider identity scope is required for ${provider}`);
    }
    const identity = await upsertAuthIdentity({
      userId: input.userId,
      provider,
      issuerEnvironment,
      tenantId,
      subject,
      db,
    });
    return { id: Number(identity.id), provider };
  }
  const result = await db.query(
    `select id, provider from auth_providers
      where user_id = $1 and provider = $2
      order by is_primary desc, created_at desc
      limit 1`,
    [input.userId, provider],
  );
  if (!result.rows[0]) return null;
  return {
    id: Number(result.rows[0].id),
    provider: String(result.rows[0].provider),
  };
}

function mapUser(row: Row): DbAomiUser {
  return {
    id: String(row.id),
    betterAuthUserId: null,
    displayName: optionalString(row.username),
    primaryEmail: undefinedToNull(row.primary_email),
    avatarUrl: null,
    metadata: {},
    deactivatedAt: row.status && row.status !== "active" ? new Date() : null,
    createdAt: secondsToDate(row.created_at),
    updatedAt: secondsToDate(row.updated_at),
  };
}

function mapIdentity(row: Row): DbAomiAuthIdentity {
  const metadata = asRecord(row.provider_metadata);
  const provider = publicProvider(String(row.provider));
  return {
    id: String(row.id),
    userId: String(row.user_id),
    provider,
    issuerEnvironment: String(row.issuer_environment),
    tenantId: String(row.tenant_id),
    subject: String(row.subject ?? row.value ?? ""),
    email: optionalString(metadata.email),
    displayLabel: optionalString(metadata.display_label),
    providerMetadata: metadata,
    verifiedAt: row.verified_at == null ? null : secondsToDate(row.verified_at),
    linkedAt: secondsToDate(row.created_at),
    lastSeenAt: secondsToDate(row.updated_at),
    revokedAt: null,
  };
}

function mapWallet(row: Row, provider: string | null): DbAomiWallet {
  const family = walletFamily(String(row.chain_type));
  const address = String(row.address);
  const walletMetadata = asRecord(row.authorization_metadata);
  const providerMetadata = asRecord(row.wallet_provider_metadata);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    family,
    address,
    normalizedAddress: normalizeWalletAddress(family, address),
    caip10: null,
    chainScope: null,
    kind:
      provider && provider !== "siwe" && provider !== "siws"
        ? "embedded"
        : "external",
    provider: provider ? publicProvider(provider) : null,
    providerWalletId: null,
    linkedVia: provider ? publicProvider(provider) : "import",
    label:
      optionalString(walletMetadata.display_label) ??
      optionalString(providerMetadata.display_label),
    displayMetadata: walletMetadata,
    verifiedAt: secondsToDate(row.created_at),
    lastSeenAt: secondsToDate(row.updated_at),
    revokedAt: null,
  };
}

function toLinkedAccount(identity: DbAomiAuthIdentity): LinkedAuthAccount {
  return {
    id: identity.id,
    provider: identity.provider,
    issuerEnvironment: identity.issuerEnvironment,
    tenantId: identity.tenantId,
    subject: identity.subject,
    email: identity.email ?? undefined,
    displayLabel: identity.displayLabel ?? undefined,
    linkedAt: identity.linkedAt.getTime(),
    lastSeenAt: identity.lastSeenAt.getTime(),
  };
}

function toAccountWallet(wallet: DbAomiWallet): AccountWallet {
  return {
    id: wallet.id,
    family: wallet.family,
    address: wallet.address,
    kind: wallet.kind,
    provider: wallet.provider ?? undefined,
    providerWalletId: wallet.providerWalletId ?? undefined,
    chainScope: wallet.chainScope ?? undefined,
    linkedVia: wallet.linkedVia,
    label: wallet.label,
    verifiedAt: wallet.verifiedAt.getTime(),
    lastSeenAt: wallet.lastSeenAt.getTime(),
  };
}

function canonicalProvider(provider: string): string {
  const normalized = provider.trim();
  if (normalized === "better_auth") return BETTER_AUTH_PROVIDER;
  return normalized;
}

function publicProvider(provider: string): AuthIdentityProvider {
  return (
    provider === BETTER_AUTH_PROVIDER ? "better_auth" : provider
  ) as AuthIdentityProvider;
}

function canonicalChainType(family: WalletFamily): string {
  return family === "svm" ? "svm" : "evm";
}

function walletFamily(chainType: string): WalletFamily {
  return chainType.trim().toLowerCase() === "svm" ? "svm" : "evm";
}

function canonicalAddress(family: WalletFamily, address: string): string {
  return normalizeWalletAddress(family, address);
}

function siweSubject(address: string): string {
  return `eip155:*:${normalizeWalletAddress("evm", address)}`;
}

function siwsSubject(address: string): string {
  return `solana:*:${normalizeWalletAddress("svm", address)}`;
}

function deriveDisplayName(email?: string | null): string | null {
  if (!email) return null;
  return email.split("@")[0] || email;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toMillis(value?: Date | string | number | null): number | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function secondsToDate(value: unknown): Date {
  const seconds = Number(value ?? nowSeconds());
  return new Date(seconds * 1000);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function undefinedToNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function isMissingRelation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}
