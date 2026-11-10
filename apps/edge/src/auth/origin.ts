import { z } from "zod";
import type { EdgeEnv } from "../env";
import { config } from "../kernel/config";
import { EdgeError } from "../kernel/errors";

const legacyPolicy = z
  .object({
    origin: z.url(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const policies = new WeakMap<
  EdgeEnv,
  { origin: string; host: string; until: number } | null
>();

/** Optional, bounded legacy authority. The primary origin always remains BETTER_AUTH_URL. */
export function authOrigin(
  env: EdgeEnv,
  host: string,
  now = Date.now(),
): string | undefined {
  let policy = policies.get(env);
  if (policy === undefined) {
    policy = null;
    if (env.PORTAL_LEGACY_AUTH) {
      try {
        const parsed = legacyPolicy.parse(JSON.parse(env.PORTAL_LEGACY_AUTH));
        const legacy = new URL(parsed.origin);
        const canonical = new URL(env.BETTER_AUTH_URL ?? "");
        if (
          legacy.protocol !== "https:" ||
          legacy.origin !== parsed.origin ||
          legacy.origin === canonical.origin ||
          canonical.protocol !== "https:" ||
          !config(env).portal.hosts.has(legacy.host) ||
          !config(env).portal.hosts.has(canonical.host)
        )
          throw new Error(
            "legacy auth must name a distinct admitted HTTPS Portal origin",
          );
        policy = {
          origin: legacy.origin,
          host: legacy.host,
          until: Date.parse(parsed.expiresAt),
        };
      } catch (cause) {
        throw new EdgeError(503, "auth_unconfigured", { cause });
      }
    }
    policies.set(env, policy);
  }
  // Evaluate the deadline on every request, not when the auth server is cached.
  return policy && host.toLowerCase() === policy.host && now < policy.until
    ? policy.origin
    : env.BETTER_AUTH_URL;
}
