"use client";

export type TelegramLaunch = {
  botId: string;
  telegramUserId: string;
  startParam?: string;
  /** Epoch seconds, as verified by `/api/telegram/launch`. */
  authDate: number;
};

/** How long the portal's widget-auth routes accept a launch proof.
 *
 *  This app's own `/api/telegram/launch` accepts 24 hours, but every call that
 *  matters — `custom-auth`, `exchange` — forces five minutes. A Mini App left
 *  open past that point looks fine and then fails mid-ceremony with `expired`,
 *  which reads as a bug rather than as "reopen this". Knowing the deadline lets
 *  the page say so first. Kept slightly under the server's window so a request
 *  started just inside it still lands. */
export const LAUNCH_PROOF_TTL_MS = 4.5 * 60 * 1000;

/** Whether the launch proof is still inside the window the BFF will accept. */
export function launchProofIsFresh(
  launch: LaunchContext | null,
  now: number = Date.now(),
): boolean {
  // A local preview has no proof and no deadline to miss.
  if (!launch?.proof) return true;
  return now - launch.authDate * 1000 < LAUNCH_PROOF_TTL_MS;
}

/** Every launch this app receives is an inline `web_app` button built by the
 *  bot, and that URL always carries `session_id`
 *  (product-mono `aomi/bin/telegram/src/mini_app.rs`). Telegram only populates
 *  `start_param` for direct-link launches (`t.me/<bot>/<app>?startapp=…`),
 *  which nothing generates — so the old fallback to it was unreachable code
 *  that read as a supported path. If direct links are ever added, restore it
 *  deliberately, with the bot emitting the parameter. */

export type LaunchContext = {
  /** Epoch seconds from the verified launch; 0 when there is no proof. */
  authDate: number;
  inTelegram: boolean;
  proof: {
    botId: string;
    initData: string;
    telegramUserId: string;
  } | null;
  sessionId: string | null;
  verified: boolean;
};

function queryValue(name: string): string | null {
  const value = new URLSearchParams(window.location.search).get(name)?.trim();
  return value || null;
}

function isLocalPreview(): boolean {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

export async function establishTelegramLaunch(): Promise<LaunchContext> {
  const webApp = window.Telegram?.WebApp;
  webApp?.ready();
  webApp?.expand();

  const querySessionId = queryValue("session_id");
  if (!webApp?.initData) {
    if (!isLocalPreview()) throw new Error("open_from_telegram");
    return {
      authDate: 0,
      inTelegram: false,
      proof: null,
      sessionId: querySessionId,
      verified: false,
    };
  }

  const botId = queryValue("bot_id");
  if (!botId) throw new Error("missing_bot_id");

  const response = await fetch("/api/telegram/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botId, initData: webApp.initData }),
  });
  const body = (await response.json().catch(() => null)) as
    | (TelegramLaunch & { error?: never })
    | { error?: string }
    | null;
  if (!response.ok || !body || "error" in body) {
    throw new Error(body?.error ?? "invalid_telegram_launch");
  }
  const launch = body as TelegramLaunch;

  return {
    authDate: launch.authDate,
    inTelegram: true,
    proof: {
      botId,
      initData: webApp.initData,
      telegramUserId: launch.telegramUserId,
    },
    sessionId: querySessionId,
    verified: true,
  };
}
