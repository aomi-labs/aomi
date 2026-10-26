import type { EdgeCache, EdgeEnv } from "../env";
import type { FetchLike } from "../routing/upstream";
import { TASK_BUILD_PATH } from "../routing/routes";

/**
 * The Task discovery challenge: the API Server's own body-bound 402 for its
 * published example request, cached for its validity window and served to
 * venue probes that cannot or will not send a body (GET, HEAD, an empty POST).
 *
 * Two rules, both tested:
 * - the Worker never invents a `Payment-Required`; it relays the one the
 *   payment service signed, and the body the venue would have to POST is in
 *   the response, so a payer who retries buys exactly that preparation;
 * - cache hits reuse a quote rather than creating another ledger attempt;
 *   concurrent misses and different isolates can still create extra quotes.
 */
export type DiscoveryChallenge = {
  /** The upstream `Payment-Required` header, byte for byte. */
  paymentRequired: string;
  /** Metadata from the upstream GET merged with the upstream 402 body. */
  body: Record<string, unknown>;
};

// Preparation quotes live 300 seconds; stop serving them with margin to spare.
export const DISCOVERY_CHALLENGE_TTL_SECONDS = 240;
const CACHE_VERSION = "v1";

type CachedEntry = { expiresAt: number; value: string };
const memory = new Map<string, CachedEntry>();

/** Tests share one module; let each start from an empty in-memory cache. */
export function resetDiscoveryCache(): void {
  memory.clear();
}

function cacheKey(origin: URL): string {
  return `task:discovery:${CACHE_VERSION}:${origin.host}`;
}

async function readCache(
  key: string,
  cache: EdgeCache | undefined,
  now: number,
): Promise<DiscoveryChallenge | null> {
  const raw = cache
    ? await cache.get(key)
    : (() => {
        const entry = memory.get(key);
        return entry && entry.expiresAt > now ? entry.value : null;
      })();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DiscoveryChallenge;
    return typeof parsed.paymentRequired === "string" && parsed.body
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function writeCache(
  key: string,
  value: DiscoveryChallenge,
  cache: EdgeCache | undefined,
  now: number,
): Promise<void> {
  const raw = JSON.stringify(value);
  if (cache) {
    await cache.put(key, raw, { expirationTtl: DISCOVERY_CHALLENGE_TTL_SECONDS });
  } else {
    memory.set(key, {
      expiresAt: now + DISCOVERY_CHALLENGE_TTL_SECONDS * 1000,
      value: raw,
    });
  }
}

async function jsonObject(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the discovery challenge for one API Server origin, from cache or by
 * asking the upstream for its metadata and then its 402 for the example body.
 * Returns null when the upstream cannot produce one; callers then fall back to
 * forwarding the request as it is.
 */
export async function discoveryChallenge(
  apiServerOrigin: URL,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  now: number = Date.now(),
): Promise<DiscoveryChallenge | null> {
  const key = cacheKey(apiServerOrigin);
  const cached = await readCache(key, env.EDGE_CACHE, now);
  if (cached) return cached;

  const buildUrl = new URL(TASK_BUILD_PATH, apiServerOrigin);
  let metadata: Record<string, unknown> | null;
  try {
    const response = await fetchImpl(
      new Request(buildUrl, { headers: { accept: "application/json" } }),
      { cache: "no-store" },
    );
    metadata = response.ok ? await jsonObject(response) : null;
  } catch {
    return null;
  }
  const example = metadata?.exampleRequest;
  if (!metadata || !example || typeof example !== "object") return null;

  let challenge: Response;
  try {
    challenge = await fetchImpl(
      new Request(buildUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(example),
      }),
      { cache: "no-store" },
    );
  } catch {
    return null;
  }
  const paymentRequired = challenge.headers.get("Payment-Required");
  if (challenge.status !== 402 || !paymentRequired) return null;
  const body = (await jsonObject(challenge)) ?? {};

  const value: DiscoveryChallenge = {
    paymentRequired,
    body: { ...metadata, ...body },
  };
  await writeCache(key, value, env.EDGE_CACHE, now);
  return value;
}

/** The HTTP shape of a discovery challenge; HEAD gets the headers alone. */
export function discoveryResponse(
  challenge: DiscoveryChallenge,
  method: string,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Payment-Required": challenge.paymentRequired,
    "Cache-Control": "no-store",
  });
  return new Response(
    method === "HEAD" ? null : JSON.stringify(challenge.body),
    { status: 402, headers },
  );
}
