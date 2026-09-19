import { getOrCreateAomiUserForBetterAuthSession } from "@aomi-labs/account/account";
import { auth } from "@aomi-labs/account/better-auth";
import {
  issueWidgetSession,
  requireWidgetOrigin,
} from "@aomi-labs/account/widget-auth";
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
  // The widget origin was validated above. Better Auth's server-side anonymous
  // sign-in must not re-interpret that third-party Origin as a request to one
  // of its own browser endpoints.
  const authHeaders = new Headers(request.headers);
  authHeaders.delete("origin");
  authHeaders.delete("referer");
  const anonymous = await auth.api.signInAnonymous({
    headers: authHeaders,
  });
  const user = await getOrCreateAomiUserForBetterAuthSession({
    betterAuthUserId: anonymous.user.id,
    email: anonymous.user.email,
    emailVerified: anonymous.user.emailVerified,
    name: anonymous.user.name,
    avatarUrl: anonymous.user.image,
  });
  const session = await issueWidgetSession({
    userId: user.id,
    origin,
    authMethod: "anonymous",
  });
  return widgetSessionResponse(session);
}, "widget.guest");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
