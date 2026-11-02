import {
  getOrCreateAomiUserForBetterAuthSession,
  signInWithVerifiedProviderIdentity,
} from "@aomi-labs/account/account";
import {
  aomiOAuthResourcePolicy,
  readManagedOAuthClient,
  validateAomiResourceScopes,
} from "@aomi-labs/account/better-auth";
import {
  createWidgetSiweChallenge,
  createWidgetSiwsChallenge,
  issueWidgetOAuthBootstrapTicket,
  issueWidgetSession,
  requireWidgetOrigin,
  revokeWidgetSession,
  sha256Hex,
  verifyWidgetSiweProof,
  verifyWidgetSiwsProof,
  widgetSessionIdentifierForRequest,
  WidgetAuthError,
  type AccountSession,
  type WidgetChallenge,
} from "@aomi-labs/account/widget-auth";
import { z } from "zod";

import type { Call } from "../routes";
import { verifyWidgetProviderCredential } from "./exchange";

/** The snake_case widget session envelope every issuing route returns. */
function sessionResponse(session: AccountSession): Response {
  return Response.json({
    access_token: session.token,
    token_type: session.tokenType,
    expires_at: session.expiresAt,
    user: { id: session.userId },
  });
}

function challengeResponse(challenge: WidgetChallenge): Response {
  return Response.json({
    nonce: challenge.nonce,
    domain: challenge.domain,
    uri: challenge.uri,
    issued_at: challenge.issuedAt,
    expiration_time: challenge.expirationTime,
  });
}

function linkedElsewhere(resolution: object): Response {
  return Response.json(
    { ...resolution, error: "already_linked_to_another_account" },
    { status: 409 },
  );
}

async function json(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

/**
 * The one guest sign-in. On the portal's own origin (or from a server, with no
 * Origin) it is a Better Auth guest session: a cookie, and the same token as a
 * bearer. An embed on another site gets an origin-bound widget session
 * instead, since its browser never sends the portal's cookies.
 */
export async function signInGuest({ request, auth }: Call): Promise<Response> {
  const claimed = request.headers.get("origin");
  if (!claimed || claimed === new URL(request.url).origin) {
    if (await auth.api.getSession({ headers: request.headers }))
      return Response.json({ code: "session_exists" }, { status: 409 });
    const { headers, response } = await auth.api.signInAnonymous({ headers: request.headers, returnHeaders: true });
    return Response.json(response, { headers });
  }
  const origin = requireWidgetOrigin(request);
  // The embedding site's Origin is not a call to Better Auth's own browser endpoints.
  const headers = new Headers(request.headers);
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("cookie");
  const anonymous = await auth.api.signInAnonymous({ headers });
  const user = await getOrCreateAomiUserForBetterAuthSession({
    betterAuthUserId: anonymous.user.id,
    email: anonymous.user.email,
    emailVerified: anonymous.user.emailVerified,
    name: anonymous.user.name,
    avatarUrl: anonymous.user.image,
  });
  return sessionResponse(
    await issueWidgetSession({
      userId: user.id,
      origin,
      authMethod: "anonymous",
    }),
  );
}

export async function exchangeProvider({ request }: Call): Promise<Response> {
  const origin = requireWidgetOrigin(request);
  const { descriptor, identity } = await verifyWidgetProviderCredential(
    await json(request),
  );
  const resolution = await signInWithVerifiedProviderIdentity({
    identity,
    policy: descriptor.policy,
    displayName: identity.email?.value,
  });
  if (resolution.status === "conflict") return linkedElsewhere(resolution);
  return sessionResponse(
    await issueWidgetSession({
      userId: resolution.user.id,
      origin,
      authMethod: descriptor.id,
      providerIdentityId: resolution.identity.id,
    }),
  );
}

export async function revokeSession({ request }: Call): Promise<Response> {
  return (await revokeWidgetSession({ request }))
    ? new Response(null, { status: 204 })
    : Response.json({ error: "invalid_widget_session" }, { status: 401 });
}

const siweChallenge = z.object({
  wallet_address: z.string().min(1),
  chain_id: z.number().int().positive(),
});
const siwsChallenge = z.object({
  wallet_address: z.string().min(1),
  chain_id: z.string().min(1),
});
const proof = { message: z.string().min(1), signature: z.string().min(1) };

export async function siweNonce({ request }: Call): Promise<Response> {
  const input = siweChallenge.parse(await json(request));
  return challengeResponse(
    await createWidgetSiweChallenge({
      request,
      walletAddress: input.wallet_address,
      chainId: input.chain_id,
    }),
  );
}

export async function siweVerify({ request }: Call): Promise<Response> {
  const input = siweChallenge.extend(proof).parse(await json(request));
  return sessionResponse(
    await verifyWidgetSiweProof({
      request,
      message: input.message,
      signature: input.signature,
      walletAddress: input.wallet_address,
      chainId: input.chain_id,
    }),
  );
}

export async function siwsNonce({ request }: Call): Promise<Response> {
  const input = siwsChallenge.parse(await json(request));
  return challengeResponse(
    await createWidgetSiwsChallenge({
      request,
      walletAddress: input.wallet_address,
      chainId: input.chain_id,
    }),
  );
}

export async function siwsVerify({ request }: Call): Promise<Response> {
  const input = siwsChallenge.extend(proof).parse(await json(request));
  return sessionResponse(
    await verifyWidgetSiwsProof({
      request,
      message: input.message,
      signature: input.signature,
      walletAddress: input.wallet_address,
      chainId: input.chain_id,
    }),
  );
}

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

/** Let a signed-in widget start an OAuth grant for its registered partner client. */
export async function issueOAuthBootstrap({
  request,
  principal,
}: Call): Promise<Response> {
  const origin = requireWidgetOrigin(request);
  const sessionIdentifier = widgetSessionIdentifierForRequest(request);
  if (
    principal.kind !== "widget" ||
    principal.origin !== origin ||
    !sessionIdentifier
  )
    throw new WidgetAuthError("invalid_widget_session", 401);

  const input = bootstrapBody.parse(await json(request));
  const client = await readManagedOAuthClient(input.client_id);
  if (
    !client ||
    client.disabled ||
    client.clientClass !== "partner_widget" ||
    !client.dpopBoundAccessTokens ||
    !client.origins.includes(origin) ||
    !client.redirectUris.includes(input.redirect_uri)
  )
    throw new WidgetAuthError("invalid_oauth_client", 403);

  const policy = aomiOAuthResourcePolicy(input.resource);
  if (
    !policy ||
    policy.kind === "agentMcp" ||
    policy.kind === "pipelineMcp" ||
    !client.resources.includes(policy.identifier)
  )
    throw new WidgetAuthError("invalid_oauth_resource", 400);
  const scopes = input.scope.split(/\s+/).filter(Boolean);
  if (
    !validateAomiResourceScopes(policy.identifier, scopes).ok ||
    scopes.some((scope) => !client.scopes.includes(scope))
  )
    throw new WidgetAuthError("invalid_oauth_scope", 400);

  const issued = await issueWidgetOAuthBootstrapTicket({
    origin,
    userId: principal.accountId,
    authMethod: principal.authMethod,
    providerIdentityId: principal.providerIdentityId,
    widgetSessionIdentifier: sessionIdentifier,
    clientId: client.clientId,
    redirectUri: input.redirect_uri,
    codeChallenge: input.code_challenge,
    resource: policy.identifier,
    scopes,
    stateDigest: sha256Hex(input.state),
    channelNonceDigest: sha256Hex(input.channel_nonce),
  });
  return Response.json(
    { ticket: issued.ticket, expires_at: issued.expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
