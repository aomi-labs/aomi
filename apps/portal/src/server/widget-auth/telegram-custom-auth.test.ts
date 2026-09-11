// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  issueTelegramCustomAuthJwt,
  telegramCustomAuthJwk,
  telegramCustomAuthSubject,
} from "./telegram-custom-auth";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

describe("Telegram Custom JWT issuer", () => {
  it("uses a stable bot-independent subject and a short-lived ES256 token", async () => {
    const subject = telegramCustomAuthSubject({
      environment: "staging",
      telegramUserId: "12345",
    });
    expect(subject).toBe("aomi:telegram:staging:12345");

    const token = await issueTelegramCustomAuthJwt({
      customSubject: subject,
      privateKeyPem,
      now: new Date("2026-09-11T12:00:00Z"),
    });
    const jwk = await telegramCustomAuthJwk({ privateKeyPem });
    const { payload, protectedHeader } = await jwtVerify(
      token,
      await importJWK(jwk, "ES256"),
      { algorithms: ["ES256"] },
    );

    expect(payload).toMatchObject({ sub: subject, iat: 1_789_128_000, exp: 1_789_128_300 });
    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: "aomi-telegram-custom-auth-1" });
    expect(jwk).not.toHaveProperty("d");
  });
});
