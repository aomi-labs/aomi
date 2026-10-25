import type { EdgeEnv } from "../env";
import { config } from "./config";

// The whole backend fleet, in BACKEND_ORIGINS order: the Terraform backend
// inventory, injected by scripts/deploy.mjs. Routing never narrows this
// statically: a hosted-app request (one carrying application_id) is probed
// against every origin and sent only to one that holds the app's artifact
// right now (constrainRouteToAvailableApp). Static home-set placement stays a
// backend prefetch concern, so an app that is ready on a non-home host is never
// made unreachable by placement.
//
// Clients must send application_id on EVERY session-scoped request of a
// hosted-app thread (discovery, chat, and state polls alike); a request
// without it falls back to rendezvous-by-session and can land on a host that
// does not hold the app.
export function resolvePool(env: EdgeEnv): readonly string[] {
  return config(env).pool;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Rendezvous (highest-random-weight) order: index 0 owns the key, the rest
// are the failover order. Adding or removing one origin only moves the keys
// that hashed to it. A null key keeps the configured order.
export function rankOrigins(
  routingKey: string | null,
  origins: readonly string[],
): string[] {
  if (routingKey === null || origins.length <= 1) {
    return [...origins];
  }
  return [...origins].sort(
    (a, b) => fnv1a(`${routingKey}|${b}`) - fnv1a(`${routingKey}|${a}`),
  );
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Threads are pinned to one origin: live conversation state is in-memory on
// the owning backend host, so every request for a thread must land there. A
// thread id in the request path wins over the caller's routing header because
// it addresses a thread that may live on a different host.
export function routingKeyFor(request: Request, url: URL): string | null {
  // Telegram does not send our thread/session headers. Pin every update for
  // one registered bot by its opaque webhook secret, rather than Telegram's
  // rotating delivery IP, so the bot's in-memory session state stays local.
  const botWebhook = url.pathname.match(/^\/api\/bots\/[^/]+\/([^/]+)$/);
  if (botWebhook) return decoded(botWebhook[1]);
  const pathSession = url.pathname.match(
    /^(?:\/api\/(?:threads|sessions)|\/v1\/agent\/chat)\/([^/]+)/,
  );
  if (pathSession) return decoded(pathSession[1]);
  return (
    request.headers.get("X-Thread-Id") ||
    request.headers.get("X-Session-Id") ||
    request.headers.get("CF-Connecting-IP") ||
    null
  );
}

/** The pool ranked for this request: index 0 owns its thread, the rest are failover. */
export function rankedPool(request: Request, env: EdgeEnv): string[] {
  return rankOrigins(routingKeyFor(request, new URL(request.url)), resolvePool(env));
}
