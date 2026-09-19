/**
 * One-time wallet authorization for the Solana demo identity: the bind and
 * client_auto permit ceremonies (challenge → Ed25519 sign → commit), the SVM
 * flavor of the curl+cast ceremony the EVM studio wallet went through.
 *
 * Zero dependencies on purpose: Node's crypto speaks Ed25519 natively, and the
 * pubkey is passed in as base58 rather than derived, so no bs58/tweetnacl.
 *
 *   pnpm exec tsx demo/capture/authorize-svm.mts \
 *     --keypair ~/.aomi/test-env/svm/demo-mainnet-fork.json \
 *     --pubkey  HtVwaC8viyhowaUz6bmcfQNmwXXqEVq1e4Vr2ACs2LsA
 *
 * Requires: portal on PORTAL_URL with the E2E wallet enabled (the script
 * seeds its own cookie), backend on BACKEND_URL trusting the portal's bearer.
 * REVOKE when demos wrap: rerun the ceremony with mode `denied`.
 */

import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const PORTAL_URL = process.env.PORTAL_URL ?? "http://localhost:3500";
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8080";
const E2E_TOKEN = process.env.AOMI_E2E_WALLET_TOKEN ?? "demo-studio-local";

function arg(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${flag} <value>`);
  return value;
}

/**
 * Solana keypair JSON is 64 bytes: seed ‖ pubkey. Node wants the seed as
 * PKCS#8, which for Ed25519 is a fixed 16-byte DER prefix + the raw seed.
 */
function keyFromSolanaJson(path: string) {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  if (bytes.length !== 64) {
    throw new Error(
      `Expected a 64-byte Solana keypair JSON, got ${bytes.length}`,
    );
  }
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, bytes.slice(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
}

async function main(): Promise<void> {
  const keypairPath = arg("--keypair");
  const pubkey = arg("--pubkey");
  const key = keyFromSolanaJson(keypairPath);

  // 1. Seed the E2E cookie (Solana-only identity, fork-mainnet cluster).
  const seedUrl = new URL("/api/bff/e2e/wallet", PORTAL_URL);
  seedUrl.searchParams.set("token", E2E_TOKEN);
  seedUrl.searchParams.set("svmAddress", pubkey);
  seedUrl.searchParams.set("svmCluster", "solana:mainnet");
  seedUrl.searchParams.set("redirect", "/");
  const seeded = await fetch(seedUrl, { redirect: "manual" });
  const cookie = seeded.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  if (seeded.status >= 400 || !cookie) {
    throw new Error(
      `E2E seeding failed (HTTP ${seeded.status}). Is the portal up with ` +
        `AOMI_ENABLE_E2E_WALLET=true and a matching token?`,
    );
  }

  // 2. Mint the account bearer through the portal BFF.
  const bearerResponse = await fetch(
    new URL("/v1/account/bearer", PORTAL_URL),
    { headers: { cookie } },
  );
  const { bearer } = (await bearerResponse.json()) as { bearer?: string };
  if (!bearer) {
    throw new Error(
      `account-bearer returned HTTP ${bearerResponse.status} without a bearer ` +
        `— check AOMI_E2E_CANONICAL_USER_ID in the portal env.`,
    );
  }

  // 3. challenge → sign → commit, twice: link the wallet, then authorize
  //    unattended edge signing.
  for (const mode of ["bind", "client_auto"] as const) {
    const challenge = await fetch(
      `${BACKEND_URL}/api/account/authorization/challenge`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ chain_type: "svm", wallet: pubkey, mode }),
      },
    );
    const challengeBody = (await challenge.json()) as {
      permit?: unknown;
      message_base64?: string;
      error?: string;
    };
    if (
      !challenge.ok ||
      !challengeBody.permit ||
      !challengeBody.message_base64
    ) {
      if (mode === "bind" && challengeBody.error === "already_bound") {
        console.log("bind: already bound, continuing");
        continue;
      }
      throw new Error(
        `${mode} challenge failed (HTTP ${challenge.status}): ` +
          JSON.stringify(challengeBody).slice(0, 200),
      );
    }

    const message = Buffer.from(challengeBody.message_base64, "base64");
    const signature = sign(null, message, key).toString("base64");

    const commit = await fetch(
      `${BACKEND_URL}/api/account/authorization/commit`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          permit: challengeBody.permit,
          signature,
          signer: pubkey,
        }),
      },
    );
    const commitBody = await commit.text();
    if (!commit.ok) {
      throw new Error(
        `${mode} commit failed (HTTP ${commit.status}): ${commitBody.slice(0, 200)}`,
      );
    }
    console.log(`${mode}: committed -> ${commitBody.slice(0, 120)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
