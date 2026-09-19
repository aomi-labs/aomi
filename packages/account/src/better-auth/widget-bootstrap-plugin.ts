import { createHash } from "node:crypto";
import { type BetterAuthPlugin, type User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { findAomiUserById, findAuthIdentityById } from "../db/queries";
import { linkProviderIdentity } from "../service/account-service";
import {
  consumeWidgetOAuthBootstrapTicket,
  sha256Hex,
} from "../widget-auth/oauth-bootstrap";
import { validateWidgetSessionBinding } from "../widget-auth/session";
import { readManagedOAuthClient } from "./managed-clients";
import { aomiOAuthResourcePolicy } from "./oauth-policy";

const bodySchema = z.object({
  ticket: z.string().startsWith("aomi_obt_").max(256),
  origin: z.string().url(),
  channelNonce: z.string().min(16).max(512),
  state: z.string().min(16).max(512),
  confirmed: z.literal(true),
});

/** Exchanges a short-lived WST-bound bootstrap ticket for a first-party
 * session. OAuth code and token issuance still go through Better Auth's normal
 * authorization endpoint after this explicit user-confirmed handoff. */
export function aomiWidgetOAuthBootstrapPlugin(): BetterAuthPlugin {
  return {
    id: "aomi-widget-oauth-bootstrap",
    endpoints: {
      redeemWidgetOAuthBootstrap: createAuthEndpoint(
        "/aomi/widget-bootstrap/redeem",
        {
          method: "POST",
          body: bodySchema,
          requireRequest: true,
        },
        async (ctx) => {
          const body = ctx.body;
          const ticket = await consumeWidgetOAuthBootstrapTicket({
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
            (providerIdentity &&
              (providerIdentity.userId !== ticket.userId ||
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
                !resourcePolicy.allowedScopes.includes(scope),
            )
          ) {
            throw unauthorized("oauth_client_policy_changed");
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

          const oldSession = await getSessionFromCtx(ctx);
          if (oldSession) {
            await ctx.context.internalAdapter.deleteSession(
              oldSession.session.token,
            );
          }
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            success: true,
            authorization: {
              clientId: ticket.clientId,
              redirectUri: ticket.redirectUri,
              codeChallenge: ticket.codeChallenge,
              codeChallengeMethod: "S256",
              resource: ticket.resource,
              scopes: ticket.scopes,
            },
          });
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
