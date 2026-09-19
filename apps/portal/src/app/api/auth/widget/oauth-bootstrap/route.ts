import {
  issueWidgetOAuthBootstrapTicket,
  requireWidgetOrigin,
  sha256Hex,
  widgetSessionIdentifierForRequest,
  WidgetAuthError,
} from "@aomi-labs/account/widget-auth";
import {
  aomiOAuthResourcePolicy,
  readManagedOAuthClient,
  validateAomiResourceScopes,
} from "@aomi-labs/account/better-auth";
import { requirePortalPrincipal } from "@portal/server/widget-auth/principal";
import { widgetAuthRateLimit } from "@portal/server/widget-auth/rate-limit";
import {
  widgetPreflight,
  widgetRoute,
} from "@portal/server/widget-auth/response";
import { z } from "zod";

const bootstrapBody = z.object({
  client_id: z.string().trim().min(1).max(255),
  redirect_uri: z.string().url().max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  resource: z.string().url().max(2048),
  scope: z.string().trim().min(1).max(1024),
  state: z.string().min(16).max(512),
  channel_nonce: z.string().min(16).max(512),
});

export const POST = widgetRoute(async (request: Request) => {
  const limited = widgetAuthRateLimit(request);
  if (limited) return limited;

  const origin = requireWidgetOrigin(request);
  const principal = await requirePortalPrincipal(request);
  if (principal.kind !== "widget" || principal.origin !== origin) {
    throw new WidgetAuthError("invalid_widget_session", 401);
  }
  const sessionIdentifier = widgetSessionIdentifierForRequest(request);
  if (!sessionIdentifier) {
    throw new WidgetAuthError("invalid_widget_session", 401);
  }

  const body = bootstrapBody.parse(await request.json().catch(() => null));
  const client = await readManagedOAuthClient(body.client_id);
  if (
    !client ||
    client.disabled ||
    client.clientClass !== "partner_widget" ||
    !client.dpopBoundAccessTokens ||
    !client.origins.includes(origin) ||
    !client.redirectUris.includes(body.redirect_uri)
  ) {
    throw new WidgetAuthError("invalid_oauth_client", 403);
  }

  const policy = aomiOAuthResourcePolicy(body.resource);
  if (
    !policy ||
    policy.kind === "agentMcp" ||
    policy.kind === "pipelineMcp" ||
    !client.resources.includes(policy.identifier)
  ) {
    throw new WidgetAuthError("invalid_oauth_resource", 400);
  }
  const scopes = body.scope.split(/\s+/).filter(Boolean);
  const scopeValidation = validateAomiResourceScopes(policy.identifier, scopes);
  if (
    !scopeValidation.ok ||
    scopes.some((scope) => !client.scopes.includes(scope))
  ) {
    throw new WidgetAuthError("invalid_oauth_scope", 400);
  }

  const issued = await issueWidgetOAuthBootstrapTicket({
    origin,
    userId: principal.userId,
    authMethod: principal.authMethod,
    providerIdentityId: principal.providerIdentityId,
    widgetSessionIdentifier: sessionIdentifier,
    clientId: client.clientId,
    redirectUri: body.redirect_uri,
    codeChallenge: body.code_challenge,
    resource: policy.identifier,
    scopes,
    stateDigest: sha256Hex(body.state),
    channelNonceDigest: sha256Hex(body.channel_nonce),
  });
  return Response.json(
    {
      ticket: issued.ticket,
      expires_at: issued.expiresAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}, "widget.oauth_bootstrap.issue");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
