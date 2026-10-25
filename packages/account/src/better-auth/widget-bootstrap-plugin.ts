import { createHash } from "node:crypto";
import { type BetterAuthPlugin, type User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import {
  findAomiUserById,
  findAuthIdentityById,
  findSignalOwner,
} from "../db/queries";
import { linkProviderIdentity } from "../service/account-service";
import {
  consumeWidgetOAuthBootstrapTicket,
  readWidgetOAuthBootstrapTicket,
  sha256Hex,
} from "../widget-auth/oauth-bootstrap";
import { validateWidgetSessionBinding } from "../widget-auth/session";
import { readManagedOAuthClient } from "./managed-clients";
import { IDENTITY_SCOPES } from "../types";
import { aomiOAuthResourcePolicy } from "./oauth-policy";

const handoffSchema = z.object({
  ticket: z.string().startsWith("aomi_obt_").max(256),
  origin: z.string().url(),
  channelNonce: z.string().min(16).max(512),
  state: z.string().min(16).max(512),
});

/** Exchanges a short-lived WST-bound bootstrap ticket for a first-party
 * session. OAuth code and token issuance still go through Better Auth's normal
 * authorization endpoint after this explicit user-confirmed handoff. */
export function aomiWidgetOAuthBootstrapPlugin(): BetterAuthPlugin {
  return {
    id: "aomi-widget-oauth-bootstrap",
    endpoints: {
      previewWidgetOAuthBootstrap: createAuthEndpoint(
        "/aomi/widget-bootstrap/preview",
        { method: "POST", body: handoffSchema, requireRequest: true },
        async (ctx) => {
          const { canonicalUser } = await validateHandoff(ctx.body);
          const session = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          const portal = await portalAccountFor(session?.user);
          ctx.setHeader("Cache-Control", "no-store");
          return ctx.json({
            widget: {
              id: canonicalUser.id,
              name: canonicalUser.displayName ?? "App account",
            },
            portal,
            sessionVersion: portalSessionVersion(
              session?.session.token,
              portal?.id,
            ),
          });
        },
      ),
      redeemWidgetOAuthBootstrap: createAuthEndpoint(
        "/aomi/widget-bootstrap/redeem",
        {
          method: "POST",
          body: handoffSchema.extend({
            confirmed: z.literal(true),
            account: z.enum(["widget", "portal"]),
            sessionVersion: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
          }),
          requireRequest: true,
        },
        async (ctx) => {
          const { ticket, canonicalUser } = await validateHandoff(ctx.body);
          const oldSession = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          const portalAccount = await portalAccountFor(oldSession?.user);
          const sessionVersion = portalSessionVersion(
            oldSession?.session.token,
            portalAccount?.id,
          );
          if (ctx.body.sessionVersion !== sessionVersion) {
            throw new APIError("CONFLICT", {
              message: "portal_session_changed",
            });
          }
          if (ctx.body.account === "portal" && !portalAccount) {
            throw unauthorized("portal_sign_in_required");
          }
          // Choice and live session are checked before the one-time consume.
          if (
            !(await consumeWidgetOAuthBootstrapTicket({
              ticket: ctx.body.ticket,
            }))
          ) {
            throw unauthorized("invalid_or_expired_bootstrap_ticket");
          }
          const authorization = {
            clientId: ticket.clientId,
            redirectUri: ticket.redirectUri,
            codeChallenge: ticket.codeChallenge,
            codeChallengeMethod: "S256" as const,
            resource: ticket.resource,
            scopes: ticket.scopes,
          };
          // Continuing as the portal account grants access through normal OAuth.
          // It never relinks the widget credential or replaces the portal cookie.
          if (
            ctx.body.account === "portal" ||
            portalAccount?.id === canonicalUser.id
          ) {
            return ctx.json({ success: true, authorization });
          }

          let user = canonicalUser.betterAuthUserId
            ? await ctx.context.adapter.findOne<User>({
                model: "user",
                where: [
                  {
                    field: "id",
                    operator: "eq",
                    value: canonicalUser.betterAuthUserId,
                  },
                ],
              })
            : null;
          let created = false;
          if (!user) {
            const email = widgetBootstrapEmail(ticket.userId);
            user =
              (
                await ctx.context.internalAdapter.findUserByEmail(email, {
                  includeAccounts: false,
                })
              )?.user ?? null;
            if (!user) {
              user = await ctx.context.internalAdapter.createUser(
                {
                  email,
                  emailVerified: false,
                  name: canonicalUser.displayName ?? "Aomi user",
                },
                { method: "widget-oauth-bootstrap" },
              );
              created = true;
            }
          }

          const linked = await linkProviderIdentity({
            userId: ticket.userId,
            provider: "better_auth",
            issuerEnvironment: "aomi",
            tenantId: "portal",
            subject: user.id,
            providerMetadata: { source: "widget_oauth_bootstrap" },
          });
          if (linked.status === "conflict") {
            if (created) await ctx.context.internalAdapter.deleteUser(user.id);
            throw new APIError("CONFLICT", {
              message: "better_auth_identity_conflict",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          await setSessionCookie(ctx, { session, user });
          if (oldSession) {
            await ctx.context.internalAdapter.deleteSession(
              oldSession.session.token,
            );
          }
          return ctx.json({ success: true, authorization });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

function widgetBootstrapEmail(userId: string): string {
  const digest = createHash("sha256").update(userId).digest("hex");
  return `widget-${digest}@accounts.invalid`;
}

function unauthorized(message: string): APIError {
  return new APIError("UNAUTHORIZED", { message });
}

async function portalAccountFor(
  user: (User & { isAnonymous?: boolean }) | undefined,
) {
  if (!user || user.isAnonymous) return null;
  const id = await findSignalOwner({
    type: "identity",
    provider: "better_auth",
    ...IDENTITY_SCOPES.betterAuth,
    subject: user.id,
  });
  if (!id) throw unauthorized("portal_account_unavailable");
  const canonical = await findAomiUserById(id);
  if (!canonical) throw unauthorized("portal_account_unavailable");
  return { id, name: canonical.displayName ?? user.name ?? "Portal account" };
}

async function validateHandoff(body: z.infer<typeof handoffSchema>) {
  const ticket = await readWidgetOAuthBootstrapTicket({
    ticket: body.ticket,
  });
  if (
    !ticket ||
    ticket.origin !== body.origin ||
    ticket.channelNonceDigest !== sha256Hex(body.channelNonce) ||
    ticket.stateDigest !== sha256Hex(body.state)
  ) {
    throw unauthorized("invalid_or_expired_bootstrap_ticket");
  }

  const [bindingValid, canonicalUser, providerIdentity, client] =
    await Promise.all([
      validateWidgetSessionBinding({
        identifier: ticket.widgetSessionIdentifier,
        origin: ticket.origin,
        userId: ticket.userId,
        authMethod: ticket.authMethod,
        providerIdentityId: ticket.providerIdentityId,
      }),
      findAomiUserById(ticket.userId),
      ticket.providerIdentityId
        ? findAuthIdentityById(ticket.providerIdentityId)
        : null,
      readManagedOAuthClient(ticket.clientId),
    ]);
  const resourcePolicy = aomiOAuthResourcePolicy(ticket.resource);
  if (
    !bindingValid ||
    !canonicalUser ||
    (ticket.providerIdentityId &&
      (!providerIdentity ||
        providerIdentity.userId !== ticket.userId ||
        providerIdentity.revokedAt !== null ||
        providerIdentity.provider !== ticket.authMethod))
  ) {
    throw unauthorized("invalid_widget_session_binding");
  }
  if (
    !client ||
    client.disabled ||
    client.clientClass !== "partner_widget" ||
    !client.dpopBoundAccessTokens ||
    !client.origins.includes(ticket.origin) ||
    !client.redirectUris.includes(ticket.redirectUri) ||
    !client.resources.includes(ticket.resource) ||
    !resourcePolicy ||
    resourcePolicy.kind === "agentMcp" ||
    resourcePolicy.kind === "pipelineMcp" ||
    ticket.scopes.some(
      (scope) =>
        !client.scopes.includes(scope) ||
        !resourcePolicy.grantableScopes.includes(scope),
    )
  ) {
    throw unauthorized("oauth_client_policy_changed");
  }

  return { ticket, canonicalUser };
}

function portalSessionVersion(
  token: string | undefined,
  accountId: string | undefined,
) {
  return token ? sha256Hex(JSON.stringify([token, accountId ?? null])) : null;
}
