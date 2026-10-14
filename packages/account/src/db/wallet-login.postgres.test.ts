// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { buildSiwsMessage } from "../../../client/src/siws";
import { buildWalletLinkMessage } from "../../../client/src/siwe";

const connectionString = process.env.AOMI_AUTH_TEST_DATABASE_URL;
const databaseName = `aomi_auth_loopback_test_siwe_${randomUUID().replaceAll("-", "")}`;
const enabled = Boolean(
  connectionString && process.env.AOMI_TEST_DATABASE_DISPOSABLE === "1",
);
// skip-reason: Requires an explicitly disposable loopback PostgreSQL database; CI supplies it.
describe.skipIf(!enabled)("canonical wallet login", () => {
  let pool: Pool;
  let admin: Pool;
  let databaseCreated = false;
  let auth: typeof import("../better-auth/auth").auth;
  let service: typeof import("../service/account-service");
  let merge: typeof import("../service/account-merge");
  let handlers: typeof import("../../../../apps/portal/src/server/account/handlers");
  const origin = "http://localhost:3999";
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (
      !/^(localhost|127\.0\.0\.1)$/.test(url.hostname) ||
      !url.pathname.startsWith("/aomi_auth_loopback_test")
    ) {
      throw new Error(
        "Wallet login tests require a disposable loopback auth database",
      );
    }
    admin = new Pool({ connectionString });
    await admin.query(`create database "${databaseName}"`);
    databaseCreated = true;
    url.pathname = `/${databaseName}`;
    vi.stubEnv("DATABASE_URL", url.toString());
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("AOMI_AUTH_EMAIL_DOMAIN", "aomi.dev");
    pool = new Pool({ connectionString: url.toString() });
    const fixture = new URL(
      "../../../../tests/fixtures/account-merge/",
      import.meta.url,
    );
    await pool.query(
      readFileSync(
        new URL("../../e2e/fixtures/canonical-account-schema.sql", fixture),
        "utf8",
      ),
    );
    await pool.query(readFileSync(new URL("schema.sql", fixture), "utf8"));
    await pool.query(
      readFileSync(
        new URL("20261007000000_account_merge.sql", fixture),
        "utf8",
      ),
    );
    ({ auth } = await import("../better-auth/auth"));
    await (await getMigrations(auth.options)).runMigrations();
    service = await import("../service/account-service");
    merge = await import("../service/account-merge");
    handlers =
      await import("../../../../apps/portal/src/server/account/handlers");
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (auth) await (await import("./pool")).getPool().end();
    if (databaseCreated) await admin.query(`drop database "${databaseName}"`);
    await admin?.end();
    vi.unstubAllEnvs();
  });

  async function request(path: string, body: unknown) {
    return auth.handler(
      new Request(`${origin}/api/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      }),
    );
  }
  function wallet(family: "evm" | "svm") {
    const evm = privateKeyToAccount(generatePrivateKey());
    const svm = nacl.sign.keyPair();
    const address = family === "evm" ? evm.address : bs58.encode(svm.publicKey);
    const chainId = family === "evm" ? 1 : "solana:mainnet";
    return {
      family,
      address,
      chainId,
      async signMessage(message: string) {
        return family === "evm"
          ? evm.signMessage({ message })
          : Buffer.from(
              nacl.sign.detached(
                new TextEncoder().encode(message),
                svm.secretKey,
              ),
            ).toString("base64");
      },
      async signIn() {
        const nonceResponse = await request(
          `${family === "evm" ? "siwe" : "siws"}/nonce`,
          family === "evm" ? {} : { walletAddress: address, chainId },
        );
        expect(nonceResponse.status).toBe(200);
        const { nonce } = await nonceResponse.json();
        const message =
          family === "evm"
            ? createSiweMessage({
                address: evm.address,
                chainId: 1,
                domain: "localhost:3999",
                uri: origin,
                version: "1",
                nonce,
              })
            : buildSiwsMessage({
                address,
                chainId: "solana:mainnet",
                intent: "sign-in",
                domain: "localhost:3999",
                uri: origin,
                nonce,
                issuedAt: new Date(),
              });
        const signature =
          family === "evm"
            ? await evm.signMessage({ message })
            : Buffer.from(
                nacl.sign.detached(
                  new TextEncoder().encode(message),
                  svm.secretKey,
                ),
              ).toString("base64");
        const response = await request(
          `${family === "evm" ? "siwe" : "siws"}/verify`,
          {
            message,
            signature,
            ...(family === "svm" ? { walletAddress: address, chainId } : {}),
          },
        );
        expect(response.status).toBe(200);
        const result = await response.json();
        const user = await service.getOrCreateAomiUserForBetterAuthSession({
          betterAuthUserId: result.user.id,
        });
        await service.getAccountResponseForBetterAuthSession({
          betterAuthUserId: result.user.id,
        });
        return { userId: user.id, betterAuthUserId: result.user.id };
      },
    };
  }
  async function link(userId: string, w: ReturnType<typeof wallet>) {
    const { issueWalletLinkNonce } = await import("../service/wallet-linking");
    const nonce = await issueWalletLinkNonce({
      userId,
      family: w.family,
      address: w.address,
      chainId: w.chainId,
    });
    const message =
      w.family === "evm"
        ? buildWalletLinkMessage({
            address: w.address,
            chainId: Number(w.chainId),
            nonce,
            domain: "localhost:3999",
            uri: origin,
          })
        : buildSiwsMessage({
            address: w.address,
            chainId: "solana:mainnet",
            intent: "link",
            nonce,
            domain: "localhost:3999",
            uri: origin,
            issuedAt: new Date(),
          });
    const response = await handlers.linkWallet({
      request: new Request(`${origin}/v1/account/wallets/link`, {
        method: "POST",
        body: JSON.stringify({
          family: w.family,
          address: w.address,
          chainId: w.chainId,
          nonce,
          message,
          signature: await w.signMessage(message),
        }),
      }),
      principal: {
        kind: "widget",
        accountId: userId,
        guest: false,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        authMethod: "test",
      },
      params: {},
    } as never);
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("linked");
  }
  for (const family of ["evm", "svm"] as const) {
    it(`${family}: sign in, unlink, sign in creates a new account without duplicate email`, async () => {
      const w = wallet(family);
      const first = await w.signIn();
      await link(first.userId, wallet(family));
      const key = await pool.query(
        `select id from public_keys where address = $1`,
        [family === "evm" ? w.address.toLowerCase() : w.address],
      );
      expect(
        await service.unlinkWallet({
          userId: first.userId,
          walletId: String(key.rows[0].id),
        }),
      ).toBe("revoked");
      const account = await service.getAccountResponseForBetterAuthSession({
        betterAuthUserId: first.betterAuthUserId,
      });
      expect(
        account.wallets.some(
          (k) => k.address.toLowerCase() === w.address.toLowerCase(),
        ),
      ).toBe(false);
      const second = await w.signIn();
      expect(second.userId).not.toBe(first.userId);
      expect(second.betterAuthUserId).not.toBe(first.betterAuthUserId);
    });
    it(`${family}: linked wallet signs into its canonical owner`, async () => {
      const a = await wallet(family).signIn();
      const w = wallet(family);
      await link(a.userId, w);
      expect((await w.signIn()).userId).toBe(a.userId);
    });
    it(`${family}: creates a BA mapping for a canonical-only wallet owner`, async () => {
      const userId = `canonical-only-${randomUUID()}`;
      await pool.query(`insert into users (id, username) values ($1, $1)`, [
        userId,
      ]);
      const w = wallet(family);
      await link(userId, w);
      expect((await w.signIn()).userId).toBe(userId);
    });
    it(`${family}: merged wallet signs into the target`, async () => {
      const a = await wallet(family).signIn();
      const w = wallet(family);
      const b = await w.signIn();
      const offer = await merge.offerAccountMerge({
        targetUserId: a.userId,
        sourceUserId: b.userId,
        credential: {
          type: "wallet",
          family,
          normalizedAddress:
            family === "evm" ? w.address.toLowerCase() : w.address,
          chainScope: null,
        },
      });
      expect(offer).not.toBeNull();
      expect(
        (
          await merge.mergeAccountWithTicket({
            targetUserId: a.userId,
            ticket: offer!.ticket,
          })
        ).status,
      ).toBe("merged");
      expect((await w.signIn()).userId).toBe(a.userId);
    });
    it(`${family}: stale BA rows cannot override canonical ownership or resurrect a removed wallet`, async () => {
      const w = wallet(family);
      const a = await w.signIn();
      await link(a.userId, wallet(family));
      const key = await pool.query(
        `select id from public_keys where address = $1`,
        [family === "evm" ? w.address.toLowerCase() : w.address],
      );
      // Simulate historical drift: canonical removal left the BA credentials behind.
      await pool.query(`delete from public_keys where id = $1`, [
        key.rows[0].id,
      ]);
      await pool.query(
        `delete from auth_providers where provider = $1 and subject = $2`,
        [
          family === "evm" ? "siwe" : "siws",
          `${family === "evm" ? "eip155" : "solana"}:*:${family === "evm" ? w.address.toLowerCase() : w.address}`,
        ],
      );
      await service.getAccountResponseForBetterAuthSession({
        betterAuthUserId: a.betterAuthUserId,
      });
      expect(
        (
          await pool.query(`select 1 from public_keys where address = $1`, [
            family === "evm" ? w.address.toLowerCase() : w.address,
          ])
        ).rowCount,
      ).toBe(0);
      const b = await wallet(family).signIn();
      await link(b.userId, w);
      expect((await w.signIn()).userId).toBe(b.userId);
    });
    it(`${family}: wallet sign-in preserves managed provider ownership and capabilities`, async () => {
      const w = wallet(family);
      const a = await w.signIn();
      const key = await pool.query(
        `select id, auth_provider_id from public_keys where address = $1`,
        [family === "evm" ? w.address.toLowerCase() : w.address],
      );
      await pool.query(
        `update auth_providers set provider = 'para', method = 'para' where id = $1`,
        [key.rows[0].auth_provider_id],
      );
      await pool.query(
        `update public_keys set provider_managed = true, signing_mode = 'autonomous', authorization_version = 7 where id = $1`,
        [key.rows[0].id],
      );
      expect((await w.signIn()).userId).toBe(a.userId);
      const after = await pool.query(
        `select auth_provider_id, provider_managed, signing_mode, authorization_version from public_keys where id = $1`,
        [key.rows[0].id],
      );
      expect(after.rows[0]).toEqual({
        auth_provider_id: key.rows[0].auth_provider_id,
        provider_managed: true,
        signing_mode: "autonomous",
        authorization_version: "7",
      });
    });
    it(`${family}: canonical keys override a stale canonical login identity`, async () => {
      const w = wallet(family);
      const a = await w.signIn();
      const b = await wallet(family).signIn();
      const address = family === "evm" ? w.address.toLowerCase() : w.address;
      const key = await pool.query(
        `select id, auth_provider_id from public_keys where address = $1`,
        [address],
      );
      await pool.query(
        `update public_keys set auth_provider_id = null, user_id = $2 where id = $1`,
        [key.rows[0].id, b.userId],
      );
      expect((await w.signIn()).userId).toBe(b.userId);
      expect(
        (
          await service.getOrCreateAomiUserForBetterAuthSession({
            betterAuthUserId: a.betterAuthUserId,
          })
        ).id,
      ).toBe(a.userId);
    });
    it(`${family}: rejects wrong domains, invalid signatures, and replay without changing ownership`, async () => {
      const w = wallet(family);
      const path = family === "evm" ? "siwe" : "siws";
      const chainId = family === "evm" ? 999999 : "solana:mainnet";
      const proof = async (domain: string, signer = w) => {
        const nonceResponse = await request(
          `${path}/nonce`,
          family === "evm" ? {} : { walletAddress: w.address, chainId },
        );
        const { nonce } = await nonceResponse.json();
        const message =
          family === "evm"
            ? createSiweMessage({
                address: w.address as `0x${string}`,
                chainId: Number(chainId),
                domain,
                uri: origin,
                version: "1",
                nonce,
              })
            : buildSiwsMessage({
                address: w.address,
                chainId: "solana:mainnet",
                intent: "sign-in",
                domain,
                uri: origin,
                nonce,
                issuedAt: new Date(),
              });
        return {
          message,
          signature: await signer.signMessage(message),
          ...(family === "svm" ? { walletAddress: w.address, chainId } : {}),
        };
      };
      expect(
        (await request(`${path}/verify`, await proof("attacker.example")))
          .status,
      ).toBe(401);
      expect(
        (
          await request(
            `${path}/verify`,
            await proof("localhost:3999", wallet(family)),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await pool.query(`select 1 from public_keys where address = $1`, [
            family === "evm" ? w.address.toLowerCase() : w.address,
          ])
        ).rowCount,
      ).toBe(0);
      const valid = await proof("localhost:3999");
      expect((await request(`${path}/verify`, valid)).status).toBe(200);
      expect((await request(`${path}/verify`, valid)).status).toBe(401);
    });
    it(`${family}: concurrent sign-ins choose one canonical account and one BA mapping`, async () => {
      const w = wallet(family);
      const [a, b] = await Promise.all([w.signIn(), w.signIn()]);
      expect(b).toEqual(a);
    });
    it(`${family}: repairs an orphan deterministic-email BA user`, async () => {
      const w = wallet(family);
      const email =
        family === "evm"
          ? `${w.address.toLowerCase()}@aomi.dev`
          : `svm-${Buffer.from(bs58.decode(w.address)).toString("hex")}@wallet.aomi.invalid`;
      const id = `orphan-${w.address}`;
      await pool.query(
        `insert into ba_users (id, name, email, email_verified, created_at, updated_at, is_anonymous) values ($1, 'orphan', $2, false, now(), now(), false)`,
        [id, email],
      );
      expect((await w.signIn()).betterAuthUserId).toBe(id);
    });
  }
});
