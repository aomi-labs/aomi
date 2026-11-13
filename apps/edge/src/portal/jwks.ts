import { createLocalJWKSet, type JSONWebKeySet, type JWTVerifyGetKey } from "jose";

import type { EdgeCache } from "../env";
import { TwoTierCache } from "../kernel/cache";
import type { FetchLike } from "../kernel/proxy";

/** How long one JWKS document serves before the edge asks the portal again. */
export const JWKS_TTL_SECONDS = 600;

const cache = new TwoTierCache();

export class JwksUnavailableError extends Error {
  constructor(cause: unknown) {
    super("jwks_unavailable", { cause });
    this.name = "JwksUnavailableError";
  }
}

/**
 * The portal's Better Auth JWKS, read through the portal upstream and cached
 * in the isolate and in KV. `fresh` bypasses the caches once, for a token whose
 * `kid` the cached set does not know (a rotation the edge has not seen yet).
 */
export async function portalJwks(input: {
  jwksUrl: string;
  cache?: EdgeCache;
  fetchImpl: FetchLike;
  now?: () => number;
  fresh?: boolean;
}): Promise<JWTVerifyGetKey> {
  const now = input.now ?? Date.now;
  const key = `jwks:v1:${input.jwksUrl}`;
  const stored = input.fresh ? null : await cache.get(key, input.cache, now());
  if (stored) {
    try {
      return createLocalJWKSet(JSON.parse(stored) as JSONWebKeySet);
    } catch {
      // A corrupt cache entry is replaced by a fresh fetch below.
    }
  }
  let keys: JSONWebKeySet;
  try {
    const response = await input.fetchImpl(
      new Request(input.jwksUrl, { headers: { accept: "application/json" } }),
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(`jwks responded ${response.status}`);
    keys = (await response.json()) as JSONWebKeySet;
    if (!Array.isArray(keys?.keys)) throw new Error("jwks document has no keys");
  } catch (error) {
    throw new JwksUnavailableError(error);
  }
  await cache.put(key, JSON.stringify(keys), JWKS_TTL_SECONDS, input.cache, now());
  return createLocalJWKSet(keys);
}

export function resetJwksCache(): void {
  cache.clear();
}
