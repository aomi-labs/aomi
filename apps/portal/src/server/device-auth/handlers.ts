import "@tanstack/react-start/server-only";
import { exchangeProviderForExistingSession } from "@aomi-labs/account/account";
import type { AomiAccountCredential } from "@aomi-labs/account";

import { createCliSession, revokeSession } from "@/server/account/cli-session";
import type { Principal } from "@/server/bff/principal";
import type { Call } from "@/server/bff/routes";
import {
  exchangeDeviceAuthGrant,
  issueDeviceAuthGrant,
  issueDeviceAuthLinkGrant,
  issueDeviceAuthLinkIntent,
  type DeviceAuthProvider,
} from "./grants";

type Fields = Record<string, unknown>;

async function body(request: Request): Promise<Fields | null> {
  return (await request.json().catch(() => null)) as Fields | null;
}

function badRequest(code: string): Response {
  return Response.json({ error: code }, { status: 400 });
}

function strings<K extends string>(
  input: Fields,
  keys: readonly K[],
): Record<K, string> | null {
  if (!keys.every((key) => typeof input[key] === "string")) return null;
  return Object.fromEntries(keys.map((key) => [key, input[key]])) as Record<
    K,
    string
  >;
}

function provider(input: Fields): DeviceAuthProvider | null {
  return input.provider === "privy" || input.provider === "para"
    ? input.provider
    : null;
}

/** Device login and linking act for the portal's own Better Auth user. */
function portalUser(principal: Principal) {
  if (principal.kind !== "cookie" && principal.kind !== "session_bearer")
    throw new Error(
      `device-auth route reached with a ${principal.kind} principal`,
    );
  return principal;
}

export async function grantDeviceLogin({
  request,
  principal,
}: Call): Promise<Response> {
  const user = portalUser(principal);
  const input = await body(request);
  if (!input) return badRequest("invalid_json");
  const fields = strings(input, ["state", "codeChallenge", "redirectUri"]);
  const chosen = provider(input);
  if (!fields || !chosen) return badRequest("invalid_request");
  const cliSession = await createCliSession(user.betterAuthUserId);
  try {
    const grant = await issueDeviceAuthGrant({
      ...fields,
      sessionToken: cliSession.sessionToken,
      expiresAt: cliSession.expiresAt,
      betterAuthUserId: user.betterAuthUserId,
      provider: chosen,
    });
    return Response.json({
      code: grant.code,
      state: grant.state,
      redirectUri: grant.redirectUri,
      expiresAt: grant.expiresAt,
    });
  } catch (error) {
    // Without a grant nobody can ever redeem the session minted for it.
    await revokeSession(cliSession.sessionToken);
    throw error;
  }
}

export async function startDeviceLink({
  request,
  principal,
}: Call): Promise<Response> {
  const user = portalUser(principal);
  const input = await body(request);
  if (!input) return badRequest("invalid_json");
  const fields = strings(input, ["state", "codeChallenge", "redirectUri"]);
  const chosen = provider(input);
  if (!fields || !chosen) return badRequest("invalid_request");
  const intent = await issueDeviceAuthLinkIntent({
    ...fields,
    betterAuthUserId: user.betterAuthUserId,
    provider: chosen,
  });
  return Response.json({
    linkIntent: intent.id,
    state: intent.state,
    redirectUri: intent.redirectUri,
    provider: intent.provider,
  });
}

export async function grantDeviceLink({ request }: Call): Promise<Response> {
  const input = await body(request);
  if (!input) return badRequest("invalid_json");
  const fields = strings(input, ["linkIntent", "state", "redirectUri"]);
  const chosen = provider(input);
  if (!fields || !chosen) return badRequest("invalid_request");
  const grant = await issueDeviceAuthLinkGrant({
    ...fields,
    provider: chosen,
    credential: input.credential,
  });
  return Response.json({
    code: grant.code,
    state: grant.state,
    redirectUri: grant.redirectUri,
    provider: grant.provider,
  });
}

export async function exchangeDeviceGrant({
  request,
}: Call): Promise<Response> {
  const input = await body(request);
  if (!input) return badRequest("invalid_json");
  const fields = strings(input, [
    "code",
    "state",
    "codeVerifier",
    "redirectUri",
  ]);
  if (!fields) return badRequest("invalid_request");
  const grant = await exchangeDeviceAuthGrant(fields);
  if (!grant) return badRequest("invalid_or_expired_code");
  if (grant.purpose === "link") {
    if (!grant.betterAuthUserId) return badRequest("invalid_or_expired_code");
    const result = await exchangeProviderForExistingSession({
      betterAuthUserId: grant.betterAuthUserId,
      credential: grant.credential as AomiAccountCredential,
    });
    return Response.json({ ...result, provider: grant.provider });
  }
  return Response.json({
    sessionToken: grant.sessionToken,
    expiresAt: grant.expiresAt,
    betterAuthUserId: grant.betterAuthUserId,
    provider: grant.provider,
  });
}
