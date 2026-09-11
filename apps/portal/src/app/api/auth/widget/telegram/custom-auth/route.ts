import { findAomiUserForTelegram } from "@aomi-labs/account/account";
import {
  requireWidgetOrigin,
  WidgetAuthError,
} from "@aomi-labs/account/widget-auth";
import { widgetAuthRateLimit } from "@portal/server/widget-auth/rate-limit";
import {
  issueTelegramCustomAuthJwt,
  verifyTrustedTelegramLaunch,
} from "@portal/server/widget-auth/telegram-custom-auth";
import {
  widgetPreflight,
  widgetRoute,
} from "@portal/server/widget-auth/response";

type CustomAuthRequest = {
  bot_id?: unknown;
  init_data?: unknown;
  /** An unbound user must consciously choose a login/link path before a JWT is issued. */
  intent?: unknown;
};

function requiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function statusForTelegramFailure(reason: string): number {
  if (reason === "bot_not_allowed") return 403;
  if (reason === "bad_signature" || reason === "expired") return 401;
  return 400;
}

export const POST = widgetRoute(async (request: Request) => {
  const limited = widgetAuthRateLimit(request);
  if (limited) return limited;
  requireWidgetOrigin(request);
  const body = (await request.json().catch(() => null)) as CustomAuthRequest | null;
  const botId = requiredString(body?.bot_id, 32);
  const initData = requiredString(body?.init_data, 16_384);
  const intent = requiredString(body?.intent, 32) ?? "status";
  if (!botId || !initData || !["status", "authenticate", "link", "new"].includes(intent)) {
    throw new WidgetAuthError("invalid_request", 400);
  }

  const trusted = verifyTrustedTelegramLaunch({ initData, botId });
  if (!trusted.ok) {
    throw new WidgetAuthError(
      trusted.reason,
      statusForTelegramFailure(trusted.reason),
    );
  }

  const userId = await findAomiUserForTelegram(
    trusted.launch.telegramUserId,
  );
  const bound = Boolean(userId);
  // A first launch must not accidentally create a second Privy user. Only an
  // explicit new-wallet or existing-wallet-link action mints the Custom JWT.
  const shouldIssue = bound
    ? intent === "status" || intent === "authenticate"
    : intent === "link" || intent === "new";

  return Response.json(
    {
      status: bound ? "bound" : "unbound",
      custom_subject: trusted.launch.customSubject,
      ...(shouldIssue
        ? {
            custom_auth_jwt: await issueTelegramCustomAuthJwt({
              customSubject: trusted.launch.customSubject,
            }),
          }
        : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}, "telegram.custom_auth");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
