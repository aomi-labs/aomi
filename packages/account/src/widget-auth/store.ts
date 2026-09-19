import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { getPool } from "../db/pool";
import { observeAccountInternalFailure } from "../observability";

/** Single owner of the widget-session identifier namespace. `session.ts`
 * imports it to build per-token identifiers; the reconciliation delete below
 * reuses it so the prefix is never hardcoded in two places. */
export const WIDGET_SESSION_NAMESPACE = "aomi:widget:session:";

/** Shared prefix for every widget-auth identifier (challenges + sessions). Used
 * to scope the opportunistic expired-row sweep so it never touches non-widget
 * Better Auth verification rows that share the `ba_verifications` table. */
const WIDGET_IDENTIFIER_PREFIX = "aomi:widget:";

/** Probability that a write also sweeps expired widget rows. Nonce/session
 * writes are frequent, so a ~1-in-50 amortized sweep keeps the table from
 * bloating under nonce spam without a dedicated janitor or a per-write scan. */
const EXPIRED_SWEEP_PROBABILITY = 0.02;

const challengeBase = {
  origin: z.string().url(),
  address: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
};

const siweChallengeSchema = z.object({
  kind: z.literal("siwe_challenge"),
  ...challengeBase,
  chainId: z.number().int().positive(),
});

const siwsChallengeSchema = z.object({
  kind: z.literal("siws_challenge"),
  ...challengeBase,
  chainId: z.string().min(1),
});

const widgetSessionSchema = z.object({
  kind: z.literal("widget_session"),
  origin: z.string().url(),
  userId: z.string().min(1),
  authMethod: z.string().min(1),
  providerIdentityId: z.string().min(1).optional(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const widgetOAuthBootstrapSchema = z.object({
  kind: z.literal("widget_oauth_bootstrap"),
  origin: z.string().url(),
  userId: z.string().min(1),
  authMethod: z.string().min(1),
  providerIdentityId: z.string().min(1).optional(),
  widgetSessionIdentifier: z.string().min(1),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  codeChallenge: z.string().min(43).max(128),
  resource: z.string().url(),
  scopes: z.array(z.string().min(1)).min(1),
  stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  channelNonceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const ticketSchema = z.discriminatedUnion("kind", [
  siweChallengeSchema,
  siwsChallengeSchema,
  widgetSessionSchema,
  widgetOAuthBootstrapSchema,
]);

export type WidgetAuthTicket = z.infer<typeof ticketSchema>;
type Db = Pool | PoolClient;
type TicketRow = QueryResultRow & { value: string };

export type WidgetAuthStore = {
  write: typeof writeWidgetAuthTicket;
  read: typeof readWidgetAuthTicket;
  consume: typeof consumeWidgetAuthTicket;
  delete: typeof deleteWidgetAuthTicket;
};

export const widgetAuthStore: WidgetAuthStore = {
  write: writeWidgetAuthTicket,
  read: readWidgetAuthTicket,
  consume: consumeWidgetAuthTicket,
  delete: deleteWidgetAuthTicket,
};

export async function writeWidgetAuthTicket(input: {
  identifier: string;
  ticket: WidgetAuthTicket;
  expiresAt: Date;
  db?: Db;
}): Promise<void> {
  const db = input.db ?? getPool();
  await db.query(
    `insert into ba_verifications
       (id, identifier, value, expires_at, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())`,
    [
      randomUUID(),
      input.identifier,
      JSON.stringify(input.ticket),
      input.expiresAt,
    ],
  );
  await sweepExpiredWidgetTickets(db);
}

/** Best-effort, probabilistic purge of expired widget challenge/session rows.
 * Scoped to the widget identifier prefix so it never deletes other Better Auth
 * verification rows, and swallowed on error so a sweep failure never fails the
 * write it piggybacks on. */
async function sweepExpiredWidgetTickets(db: Db): Promise<void> {
  if (Math.random() >= EXPIRED_SWEEP_PROBABILITY) return;
  try {
    await db.query(
      `delete from ba_verifications
        where identifier like $1 and expires_at <= now()`,
      [`${WIDGET_IDENTIFIER_PREFIX}%`],
    );
  } catch (error) {
    observeAccountInternalFailure({ kind: "widget_ticket_sweep", error });
    // Hygiene only — never surface a sweep failure to the caller.
  }
}

export async function readWidgetAuthTicket(input: {
  identifier: string;
  now: Date;
  db?: Db;
}): Promise<WidgetAuthTicket | null> {
  const result = await (input.db ?? getPool()).query<TicketRow>(
    `select value from ba_verifications
      where identifier = $1 and expires_at > $2
      order by created_at desc limit 1`,
    [input.identifier, input.now],
  );
  return parseTicket(result.rows[0]?.value);
}

export async function consumeWidgetAuthTicket(input: {
  identifier: string;
  now: Date;
  db?: Db;
}): Promise<WidgetAuthTicket | null> {
  const result = await (input.db ?? getPool()).query<TicketRow>(
    `delete from ba_verifications
      where identifier = $1 and expires_at > $2 returning value`,
    [input.identifier, input.now],
  );
  return parseTicket(result.rows[0]?.value);
}

export async function deleteWidgetAuthTicket(input: {
  identifier: string;
  db?: Db;
}): Promise<boolean> {
  const result = await (input.db ?? getPool()).query(
    `delete from ba_verifications where identifier = $1`,
    [input.identifier],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteWidgetSessionsForProviderIdentity(input: {
  providerIdentityId: string;
  db?: Db;
}): Promise<number> {
  const result = await (input.db ?? getPool()).query(
    // Narrow the scan to widget-session rows by identifier prefix, then guard
    // the jsonb cast with a CASE so it only runs on rows whose value is a JSON
    // object. CASE short-circuits, so a stray non-JSON row scanned under the
    // prefix can never make `value::jsonb` throw and abort the delete.
    `delete from ba_verifications
      where identifier like $1
        and (case when value ~ '^\\s*\\{'
                  then value::jsonb ->> 'providerIdentityId'
             end) = $2`,
    [`${WIDGET_SESSION_NAMESPACE}%`, input.providerIdentityId],
  );
  return result.rowCount ?? 0;
}

function parseTicket(value: string | undefined): WidgetAuthTicket | null {
  if (!value) return null;
  try {
    const result = ticketSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
