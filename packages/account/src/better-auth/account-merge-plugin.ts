import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";
import { observeAccountInternalFailure } from "../observability";
import { mergeGuestAccount } from "../service/account-merge";
import { getOrCreateAomiUserForBetterAuthSession } from "../service/account-service";

// Wallet and provider sign-ins. Better Auth's anonymous plugin only watches its
// own /sign-in/* paths, so these would otherwise drop the guest's chats.
const SIGN_IN_PATHS = new Set([
  "/siwe/verify",
  "/siws/verify",
  "/aomi/provider/exchange",
]);

/**
 * Session side of account merge: a guest who signs in has its account merged
 * into the one it opened, and a declined merge offer can sign this browser in
 * to the other account instead.
 */
export function aomiAccountMergePlugin() {
  return {
    id: "aomi-account-merge",
    endpoints: {
      // Server-only: the BFF checks the merge ticket, then calls this.
      switchAccountSession: createAuthEndpoint(
        "/aomi/account/switch",
        {
          method: "POST",
          body: z.object({ betterAuthUserId: z.string().min(1) }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(
            ctx.body.betterAuthUserId,
          );
          if (!user) {
            throw new APIError("NOT_FOUND", { message: "account_not_found" });
          }
          const current = await getSessionFromCtx(ctx, {
            disableRefresh: true,
          });
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          await setSessionCookie(ctx, { session, user });
          if (current) {
            await ctx.context.internalAdapter.deleteSession(
              current.session.token,
            );
          }
          return ctx.json({ status: "switched" as const });
        },
      ),
    },
    hooks: {
      after: [
        {
          matcher: (ctx) => SIGN_IN_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const signedIn = ctx.context.newSession;
            if (!signedIn || signedIn.user.isAnonymous) return;
            // The request still carries the guest's cookie.
            const guest = await getSessionFromCtx(ctx, {
              disableRefresh: true,
            });
            if (!guest?.user.isAnonymous || guest.user.id === signedIn.user.id)
              return;
            try {
              const account = await getOrCreateAomiUserForBetterAuthSession({
                betterAuthUserId: signedIn.user.id,
                email: signedIn.user.email,
                emailVerified: signedIn.user.emailVerified,
                name: signedIn.user.name,
                avatarUrl: signedIn.user.image,
              });
              await mergeGuestAccount({
                guestBetterAuthUserId: guest.user.id,
                accountUserId: account.id,
              });
              await ctx.context.internalAdapter.deleteUser(guest.user.id);
            } catch (error) {
              // The sign-in itself succeeded; losing guest chats is not worth
              // failing it.
              observeAccountInternalFailure({ kind: "guest_merge", error });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
