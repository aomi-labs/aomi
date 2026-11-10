import { createAuth, type Auth } from "@aomi-labs/account/better-auth";
import type { BetterAuthSession } from "@aomi-labs/account/principal";

import type { EdgeEnv } from "../env";
import { assertAuthBindings } from "../kernel/config";
import { authOrigin } from "./origin";

const servers = new WeakMap<EdgeEnv, Map<string, Auth>>();

/**
 * The Better Auth server, built once per wallet domain: its plugins seed the OAuth
 * resources on first use, which must not repeat per request. It holds no
 * connection; every query goes to the current request's pool
 * (`withDatabase`).
 */
export function authServer(env: EdgeEnv, walletDomain = "", now = Date.now()): Auth {
  const origin = authOrigin(env, walletDomain, now);
  const key = JSON.stringify([walletDomain, origin]);
  let domains = servers.get(env);
  if (!domains) {
    domains = new Map();
    servers.set(env, domains);
  }
  let auth = domains.get(key);
  if (!auth) {
    assertAuthBindings(env);
    // Wallet proofs follow the transport host. Only an explicitly bounded old
    // host may retain its OAuth authority while clients move to the new primary.
    const authEnv = {
      ...env,
      ...(origin ? { BETTER_AUTH_URL: origin } : {}),
      ...(walletDomain ? { AOMI_AUTH_DOMAIN: walletDomain } : {}),
    };
    auth = createAuth(authEnv as unknown as Record<string, string | undefined>);
    domains.set(key, auth);
  }
  return auth;
}

export type BetterAuthSessionSeed = {
  betterAuthUserId: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  avatarUrl?: string | null;
};

/** The Better Auth session a request carries; an explicit bearer never falls back to a cookie. */
export async function getBetterAuthSession(auth: Auth, request: Request): Promise<BetterAuthSession | null> {
  const headers = new Headers(request.headers);
  if (headers.has("authorization")) headers.delete("cookie");
  return (await auth.api.getSession({ headers })) as BetterAuthSession | null;
}

export function sessionUserSeed(session: BetterAuthSession | null): BetterAuthSessionSeed | null {
  if (!session?.user?.id) return null;
  return {
    betterAuthUserId: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    name: session.user.name,
    avatarUrl: session.user.image,
  };
}
