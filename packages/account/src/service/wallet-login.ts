import { randomUUID } from "node:crypto";
import { createLocalAccountIssuer } from "better-auth/db";
import type { PoolClient } from "pg";
import {
  findSignalOwner,
  listBetterAuthUserIds,
  lockIdentityResolutionKeys,
  upsertAuthIdentity,
} from "../db/queries";
import { IDENTITY_SCOPES, type DbAomiUser, type WalletFamily } from "../types";
import {
  getOrCreateAomiUserForSiwe,
  getOrCreateAomiUserForSiws,
} from "./account-service";
import { normalizeWalletAddress } from "./wallet-normalization";

/** Only call after verifying a single-use wallet proof. Canonical ownership
 * chooses the account; Better Auth wallet credentials are derived login state. */
export async function resolveWalletLogin(input: {
  family: WalletFamily;
  address: string;
  chainId: number | string;
  email: string;
}): Promise<{ userId: string; betterAuthUserId: string }> {
  let betterAuthUserId = "";
  const onResolved = async (user: DbAomiUser, db: PoolClient) => {
    betterAuthUserId = await deriveWalletLogin({
      ...input,
      userId: user.id,
      db,
    });
  };
  const user =
    input.family === "evm"
      ? await getOrCreateAomiUserForSiwe({
          address: input.address,
          chainId: Number(input.chainId),
          onResolved,
        })
      : await getOrCreateAomiUserForSiws({
          address: input.address,
          chainId: String(input.chainId),
          onResolved,
        });
  return { userId: user.id, betterAuthUserId };
}

async function deriveWalletLogin(input: {
  family: WalletFamily;
  address: string;
  chainId: number | string;
  email: string;
  userId: string;
  db: PoolClient;
}): Promise<string> {
  const { db, userId } = input;
  // Different wallets of the same account must choose the same login mapping.
  await lockIdentityResolutionKeys([`aomi-wallet-login:${userId}`], db);
  const ids = await listBetterAuthUserIds(userId, db);
  const mapped = await db.query(
    `select id from ba_users where id = any($1::text[]) and not coalesce(is_anonymous, false)
      order by created_at, id limit 1`,
    [ids],
  );
  let id: string | undefined = mapped.rows[0]?.id;
  if (!id) {
    const orphan = await db.query(
      `select id from ba_users where lower(email) = lower($1)`,
      [input.email],
    );
    const orphanId = orphan.rows[0]?.id;
    const owner = orphanId
      ? await findSignalOwner(
          {
            type: "identity",
            provider: "better_auth",
            ...IDENTITY_SCOPES.betterAuth,
            subject: orphanId,
          },
          db,
        )
      : null;
    if (orphanId && (!owner || owner === userId)) id = orphanId;
    if (!id) {
      id = randomUUID();
      // A removed wallet's original BA user may still serve other factors.
      const email = orphanId
        ? `${id}@wallet.aomi.invalid`
        : input.email.toLowerCase();
      await db.query(
        `insert into ba_users (id, name, email, email_verified, created_at, updated_at, is_anonymous)
         values ($1, $2, $3, false, now(), now(), false)`,
        [id, input.address, email],
      );
    }
    await upsertAuthIdentity({
      userId,
      provider: "better_auth",
      ...IDENTITY_SCOPES.betterAuth,
      subject: id,
      db,
    });
  }
  const provider = input.family === "evm" ? "siwe" : "siws";
  const address = normalizeWalletAddress(input.family, input.address);
  // Repair all chains, including rows left on an old BA user after a merge.
  await db.query(
    `delete from ba_accounts where provider_id = $1 and
      ($1 = 'siws' and account_id = $2 or $1 = 'siwe' and lower(split_part(account_id, ':', 1)) = lower($2))`,
    [provider, address],
  );
  if (input.family === "evm") {
    await db.query(
      `delete from ba_wallet_addresses where lower(address) = lower($1)`,
      [address],
    );
    await db.query(
      `insert into ba_wallet_addresses (id, user_id, address, chain_id, is_primary, created_at)
       values ($1, $2, $3, $4, false, now())`,
      [randomUUID(), id, input.address, input.chainId],
    );
  }
  await db.query(
    `insert into ba_accounts (id, user_id, provider_id, issuer, account_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, now(), now())`,
    [
      randomUUID(),
      id,
      provider,
      createLocalAccountIssuer(provider),
      input.family === "evm" ? `${input.address}:${input.chainId}` : address,
    ],
  );
  return id;
}
