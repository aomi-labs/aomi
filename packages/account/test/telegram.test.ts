// @vitest-environment node
import { generateKeyPairSync, sign as signEd25519 } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramInitData } from "../src/telegram";

// A throwaway Ed25519 pair stands in for Telegram's, so these tests exercise
// the real signature path rather than only its rejection branches.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

const BOT_ID = "8761674214";
const NOW = 1_800_000_000_000;
const AUTH_DATE = 1_800_000_000;

/** Builds a launch payload signed the way Telegram signs one: the data-check
 *  string is prefixed with the bot id, so a signature is only ever valid for
 *  the bot it was minted for. */
function signedInitData(
  input: {
    authDate?: number;
    botId?: string;
    extraFields?: Record<string, string>;
    signWith?: typeof privateKey;
    user?: unknown;
  } = {},
): string {
  const fields: Record<string, string> = {
    auth_date: String(input.authDate ?? AUTH_DATE),
    query_id: "AAExampleQueryId",
    user: JSON.stringify(input.user ?? { id: 456, username: "ada" }),
    ...input.extraFields,
  };

  const checkString = `${input.botId ?? BOT_ID}:WebAppData\n${Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n")}`;

  const params = new URLSearchParams(fields);
  params.set("hash", "unused-by-third-party-validation");
  params.set(
    "signature",
    signEd25519(
      null,
      Buffer.from(checkString),
      input.signWith ?? privateKey,
    ).toString("base64url"),
  );
  return params.toString();
}

function verify(initData: string, botId = BOT_ID) {
  return verifyTelegramInitData(initData, botId, { now: NOW, publicKeyHex });
}

describe("Telegram Mini App launch verification", () => {
  it("accepts a launch signed for the claimed bot", () => {
    expect(verify(signedInitData())).toEqual({
      ok: true,
      launch: { botId: BOT_ID, telegramUserId: "456", startParam: undefined },
    });
  });

  it("carries start_param through as the session hint", () => {
    const result = verify(
      signedInitData({ extraFields: { start_param: "thread-1" } }),
    );

    expect(result.ok && result.launch.startParam).toBe("thread-1");
  });

  it("rejects a launch replayed under a different bot id", () => {
    // The bot id is part of the signed check string, so one builder cannot take
    // another builder's launch payload and present it as their own.
    expect(verify(signedInitData(), "9999999999")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a signature minted by anyone but Telegram", () => {
    const { privateKey: attackerKey } = generateKeyPairSync("ed25519");

    expect(verify(signedInitData({ signWith: attackerKey }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects tampered user data", () => {
    const params = new URLSearchParams(signedInitData());
    params.set("user", JSON.stringify({ id: 1, username: "mallory" }));

    expect(verify(params.toString())).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a non-numeric bot id", () => {
    expect(verify(signedInitData(), "bot-123")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("requires Telegram's third-party signature", () => {
    const params = new URLSearchParams(signedInitData());
    params.delete("signature");

    expect(verify(params.toString())).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("rejects stale signed launch data before account exchange", () => {
    expect(verify(signedInitData({ authDate: 1_700_000_000 }))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects launch data dated beyond the allowed clock skew", () => {
    expect(verify(signedInitData({ authDate: AUTH_DATE + 3600 }))).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
