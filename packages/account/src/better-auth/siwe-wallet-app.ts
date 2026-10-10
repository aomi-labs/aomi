import { AsyncLocalStorage } from "node:async_hooks";
import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { parseSiweMessage } from "viem/siwe";
import { observeAccountInternalFailure } from "../observability";
import {
  getOrCreateAomiUserForBetterAuthSession,
  syncSiweWalletsForUser,
} from "../service/account-service";

// Better Auth's /siwe/verify body is strict, so the wallet app rides beside it.
const walletApp = new AsyncLocalStorage<string>();

/**
 * Takes `walletApp` off a SIWE sign-in body so Better Auth accepts it, and
 * keeps it for the sign-in hook below.
 */
export async function withSiweWalletApp(
  request: Request,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!new URL(request.url).pathname.endsWith("/siwe/verify"))
    return handler(request);
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  if (!body || !("walletApp" in body)) return handler(request);
  const { walletApp: app, ...rest } = body;
  // Node server adapters can inherit Request.prototype without its native state.
  const stripped = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(rest),
    signal: request.signal,
  });
  const name =
    typeof app === "string"
      ? app
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim()
          .slice(0, 80)
      : "";
  return name
    ? walletApp.run(name, () => handler(stripped))
    : handler(stripped);
}

/** A SIWE sign-in records the wallet app the way a wallet link does. */
export function aomiSiweWalletAppPlugin() {
  return {
    id: "aomi-siwe-wallet-app",
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/siwe/verify",
          handler: createAuthMiddleware(async (ctx) => {
            const app = walletApp.getStore();
            const signedIn = ctx.context.newSession;
            if (!app || !signedIn) return;
            try {
              const { address } = parseSiweMessage(
                String((ctx.body as { message?: unknown })?.message ?? ""),
              );
              if (!address) return;
              const account = await getOrCreateAomiUserForBetterAuthSession({
                betterAuthUserId: signedIn.user.id,
                email: signedIn.user.email,
                emailVerified: signedIn.user.emailVerified,
                name: signedIn.user.name,
                avatarUrl: signedIn.user.image,
              });
              await syncSiweWalletsForUser({
                aomiUserId: account.id,
                betterAuthUserId: signedIn.user.id,
                walletApp: app,
                walletAppAddress: address,
              });
            } catch (error) {
              // The sign-in itself succeeded; a missing app name is not worth
              // failing it.
              observeAccountInternalFailure({ kind: "wallet_app", error });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
