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
const serviceWith = (ttlMs?: number) =>
  createDeviceAuthGrantService({
    secret,
    store: createPostgresDeviceAuthRecordStore(
      undefined,
      undefined,
      identifierPrefix,
    ),
    identifierPrefix,
    ttlMs,
  });
const service = serviceWith();
// A short TTL applies to the grant under test, never to the link intent the
// grant is issued from (that would expire before it can be redeemed).
const grantService = process.env.AOMI_DEVICE_AUTH_WORKER_TTL_MS
  ? serviceWith(Number(process.env.AOMI_DEVICE_AUTH_WORKER_TTL_MS))
  : service;

async function main() {
  try {
    if (action === "issue") {
      const intent = await service.issueDeviceAuthLinkIntent({
        state,
        codeChallenge,
        redirectUri,
        betterAuthUserId: "cross-process-user-fixture",
        provider: "para",
      });
      const grant = await grantService.issueDeviceAuthLinkGrant({
        linkIntent: intent.id,
        state,
        redirectUri,
        provider: "para",
        credential: { provider: "para" },
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
