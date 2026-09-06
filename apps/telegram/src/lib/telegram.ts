"use client";

export type TelegramLaunch = {
  botId: string;
  telegramUserId: string;
  startParam?: string;
};

export type LaunchContext = {
  inTelegram: boolean;
  proof: {
    botId: string;
    initData: string;
    telegramUserId: string;
  } | null;
  sessionId: string | null;
  permissionChain: string | null;
  permissionWallet: string | null;
  permissionMode: string | null;
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
  const permissionChain = queryValue("permission_chain");
  const permissionWallet = queryValue("permission_wallet");
  const permissionMode = queryValue("permission_mode");
  if (!webApp?.initData) {
    if (!isLocalPreview()) throw new Error("open_from_telegram");
    return {
      inTelegram: false,
      proof: null,
      sessionId: querySessionId,
      permissionChain,
      permissionWallet,
      permissionMode,
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
    inTelegram: true,
    proof: {
      botId,
      initData: webApp.initData,
      telegramUserId: launch.telegramUserId,
    },
    sessionId: querySessionId ?? launch.startParam ?? null,
    permissionChain,
    permissionWallet,
    permissionMode,
    verified: true,
  };
}
