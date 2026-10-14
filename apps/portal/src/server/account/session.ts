import { auth } from "@aomi-labs/account/better-auth";

export type BetterAuthSession = {
  user?: {
    id: string;
    email?: string | null;
    emailVerified?: boolean;
    name?: string | null;
    image?: string | null;
    isAnonymous?: boolean | null;
  };
  session?: {
    token?: string;
    expiresAt?: Date | string | number | null;
    fresh?: boolean;
  };
} | null;

export type BetterAuthSessionSeed = {
  betterAuthUserId: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  avatarUrl?: string | null;
};

const sessionReads = new WeakMap<Request, Promise<BetterAuthSession>>();

/** The Better Auth session a request carries, read once per request. */
export async function getBetterAuthSession(
  req: Request,
): Promise<BetterAuthSession> {
  const existing = sessionReads.get(req);
  if (existing) return existing;
  // An explicit bearer must never fall back to an unrelated ambient cookie.
  const headers = new Headers(req.headers);
  if (headers.has("authorization")) headers.delete("cookie");
  const pending = auth.api.getSession({
    headers,
  }) as Promise<BetterAuthSession>;
  sessionReads.set(req, pending);
  return pending;
}

export function sessionUserSeed(
  session: BetterAuthSession,
): BetterAuthSessionSeed | null {
  if (!session?.user?.id) return null;
  return {
    betterAuthUserId: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    name: session.user.name,
    avatarUrl: session.user.image,
  };
}
