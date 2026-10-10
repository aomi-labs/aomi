import { auth } from "@/server/auth";

/** A separate one-day session for the CLI; the browser cookie's token is never exported or shortened. */
export async function createCliSession(betterAuthUserId: string) {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(
    betterAuthUserId,
    true,
  );
  return { sessionToken: session.token, expiresAt: session.expiresAt };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  const context = await auth.$context;
  await context.internalAdapter.deleteSession(token);
}
