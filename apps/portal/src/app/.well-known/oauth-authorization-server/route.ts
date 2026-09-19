import { auth } from "@aomi-labs/account/better-auth";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";

import { publicDiscoveryResponse } from "@portal/server/oauth/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const metadata = oauthProviderAuthServerMetadata(
  auth as unknown as Parameters<typeof oauthProviderAuthServerMetadata>[0],
);

export async function GET(request: Request) {
  return publicDiscoveryResponse(
    await codexCompatibleMetadata(await metadata(request)),
  );
}

export async function HEAD(request: Request) {
  const response = await GET(request);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export function OPTIONS() {
  return publicDiscoveryResponse(new Response(null, { status: 204 }));
}

async function codexCompatibleMetadata(response: Response): Promise<Response> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  if (body?.authorization_response_iss_parameter_supported !== true) {
    return response;
  }

  // Codex CLI 0.144 discards the RFC 9207 `iss` callback parameter but then
  // requires it when this capability is advertised. Keep emitting `iss` on
  // authorization responses; temporarily advertise it as optional so Codex
  // can finish the PKCE flow. Remove this compatibility path once Codex
  // forwards the callback issuer to its OAuth client.
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(
    { ...body, authorization_response_iss_parameter_supported: false },
    { status: response.status, statusText: response.statusText, headers },
  );
}
