import { signInWithVerifiedProviderIdentity } from "@aomi-labs/account/account";
import {
  issueWidgetSession,
  requireWidgetOrigin,
} from "@aomi-labs/account/widget-auth";
import { verifyWidgetProviderCredential } from "@portal/server/widget-auth/exchange";
import { widgetAuthRateLimit } from "@portal/server/widget-auth/rate-limit";
import {
  widgetPreflight,
  widgetRoute,
  widgetSessionResponse,
} from "@portal/server/widget-auth/response";

export const POST = widgetRoute(async (request: Request) => {
  const limited = widgetAuthRateLimit(request);
  if (limited) return limited;
  const origin = requireWidgetOrigin(request);
  const { descriptor, identity } = await verifyWidgetProviderCredential(
    await request.json().catch(() => null),
  );
  const resolution = await signInWithVerifiedProviderIdentity({
    identity,
    policy: descriptor.policy,
    displayName: identity.email?.value,
  });
  if (resolution.status === "conflict") {
    return Response.json(
      {
        ...resolution,
        error: "already_linked_to_another_account",
      },
      { status: 409 },
    );
  }
  const session = await issueWidgetSession({
    userId: resolution.user.id,
    origin,
    authMethod: descriptor.id,
    providerIdentityId: resolution.identity.id,
  });
  return widgetSessionResponse(session);
}, "widget.provider.exchange");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
