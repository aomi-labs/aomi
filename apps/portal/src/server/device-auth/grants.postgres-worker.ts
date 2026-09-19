import { createHash } from "node:crypto";
import { getPool } from "@aomi-labs/account";

import {
  createDeviceAuthGrantService,
  createPostgresDeviceAuthRecordStore,
} from "./grants";

const action = process.env.AOMI_DEVICE_AUTH_WORKER_ACTION;
const secret = process.env.AOMI_DEVICE_AUTH_WORKER_SECRET ?? "";
const identifierPrefix =
  process.env.AOMI_DEVICE_AUTH_WORKER_IDENTIFIER_PREFIX ?? "";
const state = "state_1234567890abcdef";
const codeChallenge = createHash("sha256")
  .update("worker-verifier")
  .digest("base64url");
const redirectUri = "http://127.0.0.1:49152/callback";
const service = createDeviceAuthGrantService({
  secret,
  store: createPostgresDeviceAuthRecordStore(
    undefined,
    undefined,
    identifierPrefix,
  ),
  identifierPrefix,
  ttlMs: process.env.AOMI_DEVICE_AUTH_WORKER_TTL_MS
    ? Number(process.env.AOMI_DEVICE_AUTH_WORKER_TTL_MS)
    : undefined,
});

async function main() {
  try {
    if (action === "issue") {
      const grant = await service.issueDeviceAuthGrant({
        state,
        codeChallenge,
        redirectUri,
        sessionToken: "cross-process-session-fixture",
        expiresAt: null,
        provider: "para",
      });
      process.stdout.write(JSON.stringify({ code: grant.code }));
    } else if (action === "exchange") {
      const grant = await service.exchangeDeviceAuthGrant({
        code: process.env.AOMI_DEVICE_AUTH_WORKER_CODE ?? "",
        state,
        codeVerifier: "worker-verifier",
        redirectUri,
      });
      process.stdout.write(
        JSON.stringify({ found: Boolean(grant), provider: grant?.provider }),
      );
    } else {
      throw new Error("unknown worker action");
    }
  } finally {
    await getPool().end();
  }
}

void main();
