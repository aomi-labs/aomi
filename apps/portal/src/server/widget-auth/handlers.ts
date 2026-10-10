import "@tanstack/react-start/server-only";
import {
  claimTelegramSessionOwner,
  findAomiUserForTelegram,
  getOrCreateAomiUserForBetterAuthSession,
  linkVerifiedProviderIdentityForUser,
  signInWithTelegramProviderIdentity,
  signInWithVerifiedProviderIdentity,
} from "@aomi-labs/account/account";
import { aomiOAuthResourcePolicy, readManagedOAuthClient, validateAomiResourceScopes } from "@aomi-labs/account/better-auth/core";
import { auth } from "@/server/auth";
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

import type { Call } from "@/server/bff/routes";
import { deploymentTier } from "@/server/env";
import {
  requireAttestedProviderWallets,
  verifyWidgetProviderCredential,
} from "./exchange";
import {
  issueTelegramCustomAuthJwt,
  requirePrivyCustomAuthOwner,
  statusForTrustedTelegramFailure,
  telegramCustomAuthJwk,
  telegramCustomAuthSubject,
  verifyTrustedTelegramLaunch,
} from "./telegram-custom-auth";

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

export async function signInGuest({ request }: Call): Promise<Response> {
  const origin = requireWidgetOrigin(request);
  // The widget origin was checked above; Better Auth must not read that
  // third-party Origin as a call to one of its own browser endpoints.
  const headers = new Headers(request.headers);
  headers.delete("origin");
  headers.delete("referer");
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

function requiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function trustedTelegramLaunch(input: { initData: string; botId: string }) {
  const trusted = verifyTrustedTelegramLaunch(input);
  if (!trusted.ok)
    throw new WidgetAuthError(
      trusted.reason,
      statusForTrustedTelegramFailure(trusted.reason),
    );
  return trusted.launch;
}

export async function telegramCustomAuth({ request }: Call): Promise<Response> {
  requireWidgetOrigin(request);
  const input = (await json(request)) as Record<string, unknown> | null;
  const botId = requiredString(input?.bot_id, 32);
  const initData = requiredString(input?.init_data, 16_384);
  const intent = requiredString(input?.intent, 32) ?? "status";
  if (
    !botId ||
    !initData ||
    !["status", "authenticate", "link", "new"].includes(intent)
  )
    throw new WidgetAuthError("invalid_request", 400);
  const launch = trustedTelegramLaunch({ initData, botId });
  const bound = Boolean(await findAomiUserForTelegram(launch.telegramUserId));
  // A first launch must not create a second Privy user by accident: only an
  // explicit sign-in, new-wallet or link action mints the custom JWT.
  const issue = bound
    ? intent === "authenticate"
    : intent === "link" || intent === "new";
  return Response.json(
    {
      status: bound ? "bound" : "unbound",
      custom_subject: launch.customSubject,
      ...(issue
        ? {
            custom_auth_jwt: await issueTelegramCustomAuthJwt({
              customSubject: launch.customSubject,
            }),
          }
        : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function telegramCustomAuthKeys(): Promise<Response> {
  return Response.json(
    { keys: [await telegramCustomAuthJwk()] },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

const TELEGRAM_PROVIDERS = new Set(["privy", "para"]);
const DM_THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sign a Telegram Mini App user in with a provider credential, or link it to the
 * account that owns the bot DM thread. Only DM threads (an opaque per-user
 * UUID) may be claimed: shared threads use a derivable id such as
 * `telegram:group:<chat>` that anyone in, or guessing, the chat could present.
 */
export async function exchangeTelegram({ request }: Call): Promise<Response> {
  const origin = requireWidgetOrigin(request);
  const input = (await json(request)) as Record<string, unknown> | null;
  const botId = requiredString(input?.bot_id, 32);
  const initData = requiredString(input?.init_data, 16_384);
  const sessionId = requiredString(input?.session_id, 512);
  const customUserId = requiredString(input?.custom_user_id, 512);
  if (!botId || !initData || !sessionId || !input?.credential)
    throw new WidgetAuthError("invalid_request", 400);
  if (!DM_THREAD_ID.test(sessionId))
    throw new WidgetAuthError("unsupported_session", 400);
  const launch = trustedTelegramLaunch({ initData, botId });

  const { descriptor, identity } = await verifyWidgetProviderCredential(
    input.credential,
  );
  if (
    !TELEGRAM_PROVIDERS.has(descriptor.id) ||
    descriptor.id !== identity.provider
  )
    throw new WidgetAuthError("provider_not_enabled", 400);
  // A provider session proves the person, never a wallet: ask the provider
  // which wallets it holds for this subject before anything is linked, so an
  // outage cannot leave a linked identity with no signer.
  const wallets = await requireAttestedProviderWallets(identity);

  if (customUserId) {
    if (descriptor.id !== "privy")
      throw new WidgetAuthError("provider_not_enabled", 400);
    const expected = telegramCustomAuthSubject({
      environment: deploymentTier(),
      telegramUserId: launch.telegramUserId,
    });
    if (customUserId !== expected)
      throw new WidgetAuthError("invalid_custom_auth_subject", 403);
    await requirePrivyCustomAuthOwner({
      customSubject: customUserId,
      privyUserId: identity.subject,
    });
    const resolution = await signInWithTelegramProviderIdentity({
      identity,
      policy: descriptor.policy,
      wallets,
      telegramUserId: launch.telegramUserId,
      sessionId,
    });
    if (resolution.status === "session_mismatch")
      throw new WidgetAuthError("telegram_session_mismatch", 403);
    if (resolution.status === "conflict") return linkedElsewhere(resolution);
    return sessionResponse(
      await issueWidgetSession({
        userId: resolution.user.id,
        origin,
        authMethod: "telegram_privy_custom_auth",
        providerIdentityId: resolution.identity.id,
      }),
    );
  }

  const userId = await claimTelegramSessionOwner({
    sessionId,
    telegramUserId: launch.telegramUserId,
  });
  if (!userId) throw new WidgetAuthError("telegram_session_mismatch", 403);
  const resolution = await linkVerifiedProviderIdentityForUser({
    userId,
    identity,
    policy: descriptor.policy,
    wallets,
  });
  if (resolution.status === "conflict") return linkedElsewhere(resolution);
  return sessionResponse(
    await issueWidgetSession({
      userId,
      origin,
      authMethod: `telegram_${descriptor.id}`,
      providerIdentityId: resolution.identity.id,
    }),
  );
}
