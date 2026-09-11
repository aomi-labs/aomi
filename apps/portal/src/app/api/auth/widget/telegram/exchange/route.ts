import {
  claimTelegramSessionOwner,
  linkVerifiedProviderIdentityForUser,
  signInWithTelegramProviderIdentity,
} from "@aomi-labs/account/account";
import { verifyTelegramInitData } from "@aomi-labs/account/telegram";
import {
  issueWidgetSession,
  requireWidgetOrigin,
  WidgetAuthError,
} from "@aomi-labs/account/widget-auth";
import {
  requireAttestedProviderWallets,
  verifyWidgetProviderCredential,
} from "@portal/server/widget-auth/exchange";
import { widgetAuthRateLimit } from "@portal/server/widget-auth/rate-limit";
import {
  customAuthEnvironment,
  requirePrivyCustomAuthOwner,
  telegramCustomAuthSubject,
} from "@portal/server/widget-auth/telegram-custom-auth";
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
  custom_user_id?: unknown;
  init_data?: unknown;
  session_id?: unknown;
};

const TELEGRAM_PROVIDERS = new Set(["privy", "para"]);

const DM_THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const customUserId = requiredString(body?.custom_user_id, 512);
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

  const { descriptor, identity } = await verifyWidgetProviderCredential(
    body.credential,
  );
  // Privy is the provider the portal already runs on, and its wallet API is
  // keyed by the verified token subject, so a hosted wallet can be attested
  // server-side. Para stays accepted so a Mini App build still in the wild
  // keeps working, and because portal surfaces still offer it.
  if (
    !TELEGRAM_PROVIDERS.has(descriptor.id) ||
    descriptor.id !== identity.provider
  ) {
    throw new WidgetAuthError("provider_not_enabled", 400);
  }
  // A Para session JWT proves the human, never a wallet. Ask Para's own API,
  // with the server-held secret, which embedded wallets it custodies for this
  // verified subject, and hand them to the canonical link so identity, the
  // cross-account wallet conflict check and the `public_keys` rows are all
  // decided in one transaction. Fetching before the link keeps a provider
  // outage from leaving a linked identity with no signer behind it.
  const wallets = await requireAttestedProviderWallets(identity);
  if (customUserId) {
    if (descriptor.id !== "privy") {
      throw new WidgetAuthError("provider_not_enabled", 400);
    }
    const expectedCustomUserId = telegramCustomAuthSubject({
      environment: customAuthEnvironment(),
      telegramUserId: telegram.launch.telegramUserId,
    });
    if (customUserId !== expectedCustomUserId) {
      throw new WidgetAuthError("invalid_custom_auth_subject", 403);
    }
    await requirePrivyCustomAuthOwner({
      customSubject: customUserId,
      privyUserId: identity.subject,
    });
    const resolution = await signInWithTelegramProviderIdentity({
      identity,
      policy: descriptor.policy,
      wallets,
      telegramUserId: telegram.launch.telegramUserId,
      sessionId,
    });
    if (resolution.status === "session_mismatch") {
      throw new WidgetAuthError("telegram_session_mismatch", 403);
    }
    if (resolution.status === "conflict") {
      return Response.json(
        { ...resolution, error: "already_linked_to_another_account" },
        { status: 409 },
      );
    }
    return widgetSessionResponse(
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
    telegramUserId: telegram.launch.telegramUserId,
  });
  if (!userId) {
    throw new WidgetAuthError("telegram_session_mismatch", 403);
  }
  const resolution = await linkVerifiedProviderIdentityForUser({
    userId,
    identity,
    policy: descriptor.policy,
    wallets,
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
      authMethod: `telegram_${descriptor.id}`,
      providerIdentityId: resolution.identity.id,
    }),
  );
}, "telegram.para.exchange");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
