import {
  claimTelegramSessionOwner,
  linkVerifiedProviderIdentityForUser,
} from "@aomi-labs/account/account";
import { verifyTelegramInitData } from "@aomi-labs/account/telegram";
import {
  issueWidgetSession,
  requireWidgetOrigin,
  WidgetAuthError,
} from "@aomi-labs/account/widget-auth";
import { verifyWidgetProviderCredential } from "@portal/server/widget-auth/exchange";
import { widgetAuthRateLimit } from "@portal/server/widget-auth/rate-limit";
import {
  widgetPreflight,
  widgetRoute,
  widgetSessionResponse,
} from "@portal/server/widget-auth/response";

const TELEGRAM_FAILURE_STATUS = {
  malformed: 400,
  missing_signature: 400,
  missing_user: 400,
  bad_signature: 401,
  expired: 401,
} as const;

type TelegramParaExchange = {
  bot_id?: unknown;
  credential?: unknown;
  init_data?: unknown;
  session_id?: unknown;
};

const DM_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

/**
 * Only a bot's DM threads may be claimed here. Those carry an opaque per-user
 * UUID, while shared threads use a derived id such as `telegram:group:<chat>`
 * that every member — and anyone who can guess a chat id — could present.
 * Since claiming an unowned thread binds it to the caller's account, an
 * allowlist on the DM shape is what keeps a guessable id from being claimed.
 */
function isClaimableThreadId(sessionId: string): boolean {
  return DM_THREAD_ID.test(sessionId);
}

export const POST = widgetRoute(async (request: Request) => {
  const limited = widgetAuthRateLimit(request);
  if (limited) return limited;
  const origin = requireWidgetOrigin(request);
  const body = (await request
    .json()
    .catch(() => null)) as TelegramParaExchange | null;
  const botId = requiredString(body?.bot_id, 32);
  const initData = requiredString(body?.init_data, 16_384);
  const sessionId = requiredString(body?.session_id, 512);
  if (!botId || !initData || !sessionId || !body?.credential) {
    throw new WidgetAuthError("invalid_request", 400);
  }
  if (!isClaimableThreadId(sessionId)) {
    throw new WidgetAuthError("unsupported_session", 400);
  }

  const telegram = verifyTelegramInitData(initData, botId);
  if (!telegram.ok) {
    throw new WidgetAuthError(
      telegram.reason,
      TELEGRAM_FAILURE_STATUS[telegram.reason],
    );
  }

  const userId = await claimTelegramSessionOwner({
    sessionId,
    telegramUserId: telegram.launch.telegramUserId,
  });
  if (!userId) {
    throw new WidgetAuthError("telegram_session_mismatch", 403);
  }

  const { descriptor, identity } = await verifyWidgetProviderCredential(
    body.credential,
  );
  if (descriptor.id !== "para" || identity.provider !== "para") {
    throw new WidgetAuthError("provider_not_enabled", 400);
  }
  const resolution = await linkVerifiedProviderIdentityForUser({
    userId,
    identity,
    policy: descriptor.policy,
  });
  if (resolution.status === "conflict") {
    return Response.json(
      { ...resolution, error: "already_linked_to_another_account" },
      { status: 409 },
    );
  }

  return widgetSessionResponse(
    await issueWidgetSession({
      userId,
      origin,
      authMethod: "telegram_para",
      providerIdentityId: resolution.identity.id,
    }),
  );
}, "telegram.para.exchange");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
