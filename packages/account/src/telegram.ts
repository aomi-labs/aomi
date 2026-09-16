import "server-only";

import { createPublicKey, verify as verifySignature } from "node:crypto";

const TELEGRAM_PUBLIC_KEY =
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type VerifiedTelegramLaunch = {
  botId: string;
  telegramUserId: string;
  startParam?: string;
};

export type TelegramLaunchFailure =
  | "malformed"
  | "missing_signature"
  | "missing_user"
  | "bad_signature"
  | "expired";

export type TelegramLaunchVerification =
  | { ok: true; launch: VerifiedTelegramLaunch }
  | { ok: false; reason: TelegramLaunchFailure };

function decodeBase64Url(value: string): Buffer | null {
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
}

function dataCheckString(fields: URLSearchParams, botId: string): string {
  const lines = [...fields.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
  return `${botId}:WebAppData\n${lines.join("\n")}`;
}

function telegramUserId(fields: URLSearchParams): string | null {
  const raw = fields.get("user");
  if (!raw) return null;

  try {
    const user = JSON.parse(raw) as { id?: unknown };
    return typeof user.id === "string" || typeof user.id === "number"
      ? String(user.id)
      : null;
  } catch {
    return null;
  }
}

export function verifyTelegramInitData(
  initData: string,
  botId: string,
  options: {
    now?: number;
    /** Test-only override. Production always verifies against Telegram's key. */
    publicKeyHex?: string;
  } = {},
): TelegramLaunchVerification {
  const now = options.now ?? Date.now();
  if (!initData || !/^\d+$/.test(botId)) {
    return { ok: false, reason: "malformed" };
  }

  const fields = new URLSearchParams(initData);
  const signature = fields.get("signature");
  if (!signature) return { ok: false, reason: "missing_signature" };

  const userId = telegramUserId(fields);
  if (!userId) return { ok: false, reason: "missing_user" };

  const authDate = Number(fields.get("auth_date"));
  if (!Number.isSafeInteger(authDate)) {
    return { ok: false, reason: "malformed" };
  }

  const age = now - authDate * 1000;
  if (age > MAX_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: "expired" };
  }

  const signatureBytes = decodeBase64Url(signature);
  if (!signatureBytes) return { ok: false, reason: "bad_signature" };

  const publicKey = createPublicKey({
    key: Buffer.concat([
      SPKI_ED25519_PREFIX,
      Buffer.from(options.publicKeyHex ?? TELEGRAM_PUBLIC_KEY, "hex"),
    ]),
    format: "der",
    type: "spki",
  });

  const valid = verifySignature(
    null,
    Buffer.from(dataCheckString(fields, botId), "utf8"),
    publicKey,
    signatureBytes,
  );
  if (!valid) return { ok: false, reason: "bad_signature" };

  return {
    ok: true,
    launch: {
      botId,
      telegramUserId: userId,
      startParam: fields.get("start_param") ?? undefined,
    },
  };
}
