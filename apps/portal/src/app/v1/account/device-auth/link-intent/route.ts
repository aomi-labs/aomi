import {
  issueDeviceAuthLinkIntent,
  type DeviceAuthProvider,
} from "@portal/server/device-auth/grants";
import { getBetterAuthSession, json } from "@portal/server/account/session";
import { identifyDeviceAuthFailure } from "@portal/server/bff/device-auth-errors";
import { portalFailures } from "@portal/server/bff/failures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkIntentRequest = {
  state?: unknown;
  codeChallenge?: unknown;
  redirectUri?: unknown;
  provider?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  const session = await getBetterAuthSession(req);
  if (!session?.user?.id) {
    return json(401, { error: "unauthenticated" });
  }

  const body = (await req.json().catch(() => null)) as LinkIntentRequest | null;
  if (!body) return json(400, { error: "invalid_json" });
  if (
    typeof body.state !== "string" ||
    typeof body.codeChallenge !== "string" ||
    typeof body.redirectUri !== "string"
  ) {
    return json(400, { error: "invalid_request" });
  }
  if (body.provider !== "privy" && body.provider !== "para") {
    return json(400, { error: "invalid_request" });
  }
  const provider = body.provider as DeviceAuthProvider;

  try {
    const intent = await issueDeviceAuthLinkIntent({
      state: body.state,
      codeChallenge: body.codeChallenge,
      redirectUri: body.redirectUri,
      betterAuthUserId: session.user.id,
      provider,
    });
    return Response.json({
      linkIntent: intent.id,
      state: intent.state,
      redirectUri: intent.redirectUri,
      provider: intent.provider,
    });
  } catch (error) {
    return portalFailures.handle(
      identifyDeviceAuthFailure(error, {
        routeFamily: "/v1/account/device-auth/link-intent",
        operation: "device_auth_link_intent",
      }),
    ).response;
  }
}
