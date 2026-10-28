import { exchangeProviderForExistingSession } from "@aomi-labs/account/account";
import type { AomiAccountCredential } from "@aomi-labs/account";
import type { Principal } from "@aomi-labs/account/principal";

import type { Call } from "../routes";
import {
  exchangeDeviceAuthGrant,
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

/** Device linking acts for the portal's own Better Auth user. */
function portalUser(principal: Principal) {
  if (principal.kind !== "cookie" && principal.kind !== "session_bearer")
    throw new Error(
      `device-auth route reached with a ${principal.kind} principal`,
    );
  return principal;
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
  if (!grant.betterAuthUserId) return badRequest("invalid_or_expired_code");
  const result = await exchangeProviderForExistingSession({
    betterAuthUserId: grant.betterAuthUserId,
    credential: grant.credential as AomiAccountCredential,
  });
  return Response.json({ ...result, provider: grant.provider });
}
