import {
  issueDeviceAuthLinkGrant,
  type DeviceAuthProvider,
} from "@portal/server/device-auth/grants";
import { json } from "@portal/server/account/session";
import { identifyDeviceAuthFailure } from "@portal/server/bff/device-auth-errors";
import { portalFailures } from "@portal/server/bff/failures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkGrantRequest = {
  linkIntent?: unknown;
  state?: unknown;
  redirectUri?: unknown;
  provider?: unknown;
  credential?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as LinkGrantRequest | null;
  if (!body) return json(400, { error: "invalid_json" });
  if (
    typeof body.linkIntent !== "string" ||
    typeof body.state !== "string" ||
    typeof body.redirectUri !== "string" ||
    (body.provider !== "privy" && body.provider !== "para")
  ) {
    return json(400, { error: "invalid_request" });
  }

  try {
    const grant = await issueDeviceAuthLinkGrant({
      linkIntent: body.linkIntent,
      state: body.state,
      redirectUri: body.redirectUri,
      provider: body.provider as DeviceAuthProvider,
      credential: body.credential,
    });
    return Response.json({
      code: grant.code,
      state: grant.state,
      redirectUri: grant.redirectUri,
      provider: grant.provider,
    });
  } catch (error) {
    return portalFailures.handle(
      identifyDeviceAuthFailure(error, {
        routeFamily: "/v1/account/device-auth/link-grant",
        operation: "device_auth_link_grant",
      }),
    ).response;
  }
}
