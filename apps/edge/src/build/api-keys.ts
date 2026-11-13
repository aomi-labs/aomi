/**
 * Builder API keys: a long-lived credential a builder creates on the portal
 * and a script sends as `Authorization: Bearer aomi_key_…`. The edge owns the
 * `api_keys` table (its migration ships in product-mono) and stores only the
 * key's SHA-256. A key names its builder and up to three capabilities; the
 * manager enforces them on the builder bearer the edge mints for the call.
 *
 * Managing keys takes the portal's GitHub session cookie. A CLI bearer or a
 * key cannot create, list or revoke keys.
 */
import { getPool } from "@aomi-labs/account";
import { bearerOf } from "@aomi-labs/account/build-session";
import { base64url } from "jose";
import { z } from "zod";

import { sha256Hex } from "../kernel/crypto";
import { EdgeError } from "../kernel/errors";
import { id, parseInput } from "../kernel/route";
import { authorize } from "./auth";
import type { BuildContext } from "./context";
import type { BuildRoute } from "./endpoint";

export const API_KEY_PREFIX = "aomi_key_";
/** The capabilities a key can hold; the manager's route labels. */
export const KEY_CAPABILITIES = ["project:deploy", "project:activate", "project:observe"] as const;
/** The characters of a key kept in the clear so its owner can tell keys apart. */
const DISPLAY_PREFIX_LENGTH = 16;

export function isApiKey(bearer: string): boolean {
  return bearer.startsWith(API_KEY_PREFIX);
}

/** Whether the request presents an API key, valid or not. */
export function carriesApiKey(request: Request): boolean {
  return isApiKey(bearerOf(request));
}

/** A key as its owner sees it. Times are unix seconds. */
export type ApiKey = {
  id: number;
  prefix: string;
  label: string | null;
  capabilities: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

/** What a presented key proves: its builder (a GitHub user id) and capabilities. */
export type KeyGrant = { id: number; builderId: string; capabilities: string[] };

export interface ApiKeyStore {
  create(row: { hash: string; prefix: string; builderId: string; capabilities: string[]; label: string | null }): Promise<ApiKey>;
  list(builderId: string): Promise<ApiKey[]>;
  /** Revoke a key `builderId` owns; false when there is no such key. */
  revoke(builderId: string, id: number): Promise<boolean>;
  /** The live builder key with this hash. */
  find(hash: string): Promise<KeyGrant | null>;
  touch(id: number): Promise<void>;
}

type Database = {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};

// `bigint` columns arrive as strings; ids and unix seconds fit a number.
type KeyRow = {
  id: string;
  key_prefix: string;
  label: string | null;
  capabilities: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const COLUMNS = "id, key_prefix, label, capabilities, created_at, last_used_at, revoked_at";
const NOW = "(extract(epoch from now()))::bigint";
const seconds = (value: string | null) => (value === null ? null : Number(value));

function apiKey(row: KeyRow): ApiKey {
  return {
    id: Number(row.id),
    prefix: row.key_prefix,
    label: row.label,
    capabilities: row.capabilities,
    createdAt: Number(row.created_at),
    lastUsedAt: seconds(row.last_used_at),
    revokedAt: seconds(row.revoked_at),
  };
}

/** The `api_keys` table, builder rows only. */
export function postgresKeys(db: () => Database = getPool): ApiKeyStore {
  return {
    async create({ hash, prefix, builderId, capabilities, label }) {
      const { rows } = await db().query<KeyRow>(
        `insert into api_keys (key_hash, key_prefix, principal_kind, principal_id, capabilities, label)
         values ($1, $2, 'builder', $3, $4::text[], $5)
         returning ${COLUMNS}`,
        [hash, prefix, builderId, capabilities, label],
      );
      return apiKey(rows[0]);
    },
    async list(builderId) {
      const { rows } = await db().query<KeyRow>(
        `select ${COLUMNS} from api_keys
         where principal_kind = 'builder' and principal_id = $1
         order by id desc`,
        [builderId],
      );
      return rows.map(apiKey);
    },
    async revoke(builderId, id) {
      const { rows } = await db().query(
        `update api_keys set revoked_at = coalesce(revoked_at, ${NOW})
         where id = $1 and principal_kind = 'builder' and principal_id = $2
         returning id`,
        [id, builderId],
      );
      return rows.length > 0;
    },
    async find(hash) {
      const { rows } = await db().query<{ id: string; principal_id: string; capabilities: string[] }>(
        `select id, principal_id, capabilities from api_keys
         where key_hash = $1 and principal_kind = 'builder' and revoked_at is null`,
        [hash],
      );
      const [row] = rows;
      return row ? { id: Number(row.id), builderId: row.principal_id, capabilities: row.capabilities } : null;
    },
    async touch(id) {
      await db().query(`update api_keys set last_used_at = ${NOW} where id = $1`, [id]);
    },
  };
}

/** The builder a presented key belongs to; 401 for an unknown or revoked key. */
export async function keyGrant(bearer: string, keys: ApiKeyStore): Promise<KeyGrant> {
  const grant = await keys.find(await sha256Hex(bearer));
  if (!grant || !grant.builderId.trim()) throw new EdgeError(401, "unauthenticated");
  // Best effort: a failed timestamp never fails the request.
  await keys.touch(grant.id).catch(() => undefined);
  return grant;
}

const KEYS_PATH = "/api/build/keys";
const NO_STORE = { "Cache-Control": "no-store" };

/** The signed-in builder's GitHub user id, from the portal session cookie only. */
async function portalBuilder(request: Request, ctx: BuildContext, write: boolean): Promise<string> {
  const caller = await authorize(request, ctx, { write });
  if (caller.key) throw new EdgeError(403, "api_key_not_allowed");
  return caller.session.githubUserId;
}

const createInput = z.object({
  label: z.string().trim().max(100).optional(),
  capabilities: z.array(z.enum(KEY_CAPABILITIES)).transform((names) => [...new Set(names)]),
});

async function create(request: Request, ctx: BuildContext): Promise<Response> {
  const builderId = await portalBuilder(request, ctx, true);
  const input = await parseInput(createInput, request);
  const key = API_KEY_PREFIX + base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  const created = await ctx.keys.create({
    hash: await sha256Hex(key),
    prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
    builderId,
    capabilities: input.capabilities,
    label: input.label || null,
  });
  // The only time the key itself leaves the edge.
  return Response.json({ ...created, key }, { status: 201, headers: NO_STORE });
}

async function list(request: Request, ctx: BuildContext): Promise<Response> {
  const builderId = await portalBuilder(request, ctx, false);
  return Response.json({ keys: await ctx.keys.list(builderId) }, { headers: NO_STORE });
}

async function revoke(request: Request, ctx: BuildContext): Promise<Response> {
  const builderId = await portalBuilder(request, ctx, true);
  const input = await parseInput(z.object({ id }), request);
  if (!(await ctx.keys.revoke(builderId, input.id))) throw new EdgeError(404, "api key not found for this user");
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export const KEY_ROUTES: readonly BuildRoute[] = [
  { operation: "api_key.list", method: "GET", path: KEYS_PATH, handle: list },
  { operation: "api_key.create", method: "POST", path: KEYS_PATH, handle: create },
  { operation: "api_key.revoke", method: "DELETE", path: KEYS_PATH, handle: revoke },
];
