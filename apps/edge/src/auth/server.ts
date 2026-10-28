import { createAuth, type Auth } from "@aomi-labs/account/better-auth";
import type { BetterAuthSession } from "@aomi-labs/account/principal";

import type { EdgeEnv } from "../env";
import { assertAuthBindings } from "../kernel/config";

const servers = new WeakMap<EdgeEnv, Auth>();

/**
 * The Better Auth server, built once per isolate: its plugins seed the OAuth
 * resources on first use, which must not repeat per request. It holds no
 * connection; every query goes to the current request's pool
 * (`withDatabase`).
 */
export function authServer(env: EdgeEnv): Auth {
  let auth = servers.get(env);
  if (!auth) {
    assertAuthBindings(env);
    auth = createAuth(env as unknown as Record<string, string | undefined>);
    servers.set(env, auth);
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
