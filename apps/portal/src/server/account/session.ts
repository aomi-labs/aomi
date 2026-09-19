import { auth } from "@aomi-labs/account/better-auth";
import {
  getAccountResponseForBetterAuthSession,
  getOrCreateAomiUserForBetterAuthSession,
} from "@aomi-labs/account/account";

type BetterAuthSessionResult = {
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

export async function getBetterAuthSession(req: Request) {
  return (await auth.api.getSession({
    headers: req.headers,
  })) as BetterAuthSessionResult;
}

export function sessionUserSeed(
  session: BetterAuthSessionResult,
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

export async function requireAomiSession(req: Request) {
  const session = await getBetterAuthSession(req);
  const seed = sessionUserSeed(session);
  if (!seed) return null;
  const user = await getOrCreateAomiUserForBetterAuthSession(seed);
  return { session, user };
}

export async function accountResponseFromSession(req: Request) {
  const session = await getBetterAuthSession(req);
  const seed = sessionUserSeed(session);
  if (!seed) {
    return {
      user: null,
      linkedAccounts: [],
      wallets: [],
      session: null,
    } as const;
  }
  return getAccountResponseForBetterAuthSession({
    ...seed,
    expiresAt: session?.session?.expiresAt,
    fresh: session?.session?.fresh,
  });
}

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}
