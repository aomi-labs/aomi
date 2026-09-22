import "server-only";

// Durable, one-time device-login records. This module is server-only because
// it derives an encryption key from Better Auth's deployment secret.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getPool } from "@aomi-labs/account";
import { readAccountAuthEnv } from "@aomi-labs/account/better-auth/env";

export type DeviceAuthProvider = "privy" | "para";
export type DeviceAuthGrantPurpose = "login" | "link";

type DeviceAuthGrantBase = {
  code: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
  betterAuthUserId?: string;
  provider: DeviceAuthProvider;
  createdAt: number;
};

export type DeviceAuthLoginGrant = DeviceAuthGrantBase & {
  purpose: "login";
  sessionToken: string;
  expiresAt: string | number | Date | null | undefined;
};

export type DeviceAuthLinkGrant = DeviceAuthGrantBase & {
  purpose: "link";
  credential: unknown;
};

export type DeviceAuthGrant = DeviceAuthLoginGrant | DeviceAuthLinkGrant;

export type DeviceAuthLinkIntent = {
  id: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
  betterAuthUserId: string;
  provider: DeviceAuthProvider;
  createdAt: number;
};

type StoredGrant = {
  version: 1;
  kind: "grant";
  recordExpiresAt: number;
  grant: DeviceAuthGrant;
};

type StoredLinkIntent = {
  version: 1;
  kind: "link_intent";
  recordExpiresAt: number;
  intent: DeviceAuthLinkIntent;
};

type StoredRecord = StoredGrant | StoredLinkIntent;
type Db = ReturnType<typeof getPool>;
type ValueRow = { value: string };
type UnissuedGrant =
  | Omit<DeviceAuthLoginGrant, "code" | "createdAt">
  | Omit<DeviceAuthLinkGrant, "code" | "createdAt">;

export type DeviceAuthRecordStore = {
  write(input: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<void>;
  consume(input: { identifier: string; now: Date }): Promise<string | null>;
  replace<Result>(input: {
    identifier: string;
    now: Date;
    replacement(value: string): {
      identifier: string;
      value: string;
      expiresAt: Date;
      result: Result;
    };
  }): Promise<Result | null>;
};

type IssueGrantInput = Omit<
  DeviceAuthLoginGrant,
  "code" | "createdAt" | "purpose"
>;

const IDENTIFIER_PREFIX = "aomi:device-auth:";
const GRANT_TTL_MS = 5 * 60 * 1000;
const EXPIRED_SWEEP_PROBABILITY = 0.02;
const ENVELOPE_VERSION = "v1";

export function createDeviceAuthGrantService(input: {
  secret: string;
  store: DeviceAuthRecordStore;
  now?: () => number;
  ttlMs?: number;
  identifierPrefix?: string;
}) {
  if (!input.secret.trim()) throw new Error("device_auth_secret_required");
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs ?? GRANT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > GRANT_TTL_MS) {
    throw new Error("invalid_device_auth_ttl");
  }
  const identifierPrefix = validateIdentifierPrefix(
    input.identifierPrefix ?? IDENTIFIER_PREFIX,
  );
  const grantPrefix = `${identifierPrefix}grant:`;
  const linkIntentPrefix = `${identifierPrefix}link-intent:`;
  const key = createHash("sha256")
    .update("aomi-device-auth-records-v1\0")
    .update(input.secret)
    .digest();

  function prepareGrant(grant: UnissuedGrant) {
    validateState(grant.state);
    validateCodeChallenge(grant.codeChallenge);
    validateLoopbackRedirectUri(grant.redirectUri);
    const createdAt = now();
    const code = randomBytes(32).toString("base64url");
    const issued = { ...grant, code, createdAt } as DeviceAuthGrant;
    const identifier = `${grantPrefix}${code}`;
    const record: StoredGrant = {
      version: 1,
      kind: "grant",
      recordExpiresAt: createdAt + ttlMs,
      grant: issued,
    };
    return {
      issued,
      write: {
        identifier,
        value: sealRecord(record, identifier, key),
        expiresAt: new Date(record.recordExpiresAt),
      },
    };
  }

  async function issueGrant(grant: UnissuedGrant): Promise<DeviceAuthGrant> {
    const prepared = prepareGrant(grant);
    await input.store.write(prepared.write);
    return prepared.issued;
  }

  return {
    async issueDeviceAuthGrant(
      grantInput: IssueGrantInput,
    ): Promise<DeviceAuthLoginGrant> {
      return (await issueGrant({
        ...grantInput,
        purpose: "login",
      })) as DeviceAuthLoginGrant;
    },

    async issueDeviceAuthLinkIntent(intentInput: {
      state: string;
      codeChallenge: string;
      redirectUri: string;
      betterAuthUserId: string;
      provider: DeviceAuthProvider;
    }): Promise<DeviceAuthLinkIntent> {
      validateState(intentInput.state);
      validateCodeChallenge(intentInput.codeChallenge);
      validateLoopbackRedirectUri(intentInput.redirectUri);
      if (!intentInput.betterAuthUserId) {
        throw new Error("invalid_better_auth_user_id");
      }
      const createdAt = now();
      const id = randomBytes(32).toString("base64url");
      const intent: DeviceAuthLinkIntent = {
        ...intentInput,
        id,
        createdAt,
      };
      const identifier = `${linkIntentPrefix}${id}`;
      const record: StoredLinkIntent = {
        version: 1,
        kind: "link_intent",
        recordExpiresAt: createdAt + ttlMs,
        intent,
      };
      await input.store.write({
        identifier,
        value: sealRecord(record, identifier, key),
        expiresAt: new Date(record.recordExpiresAt),
      });
      return intent;
    },

    async issueDeviceAuthLinkGrant(grantInput: {
      linkIntent: string;
      state: string;
      redirectUri: string;
      provider: DeviceAuthProvider;
      credential: unknown;
    }): Promise<DeviceAuthLinkGrant> {
      const identifier = `${linkIntentPrefix}${grantInput.linkIntent}`;
      const issued = await input.store.replace({
        identifier,
        now: new Date(now()),
        replacement: (sealed) => {
          const record = openRecord(sealed, identifier, key, now());
          if (!record || record.kind !== "link_intent") {
            throw new Error("invalid_or_expired_link_intent");
          }
          const intent = record.intent;
          if (
            !safeEqual(intent.state, grantInput.state) ||
            intent.redirectUri !== grantInput.redirectUri ||
            intent.provider !== grantInput.provider
          ) {
            throw new Error("invalid_link_intent");
          }
          if (!grantInput.credential) {
            throw new Error("invalid_provider_credential");
          }
          const prepared = prepareGrant({
            purpose: "link",
            state: intent.state,
            codeChallenge: intent.codeChallenge,
            redirectUri: intent.redirectUri,
            betterAuthUserId: intent.betterAuthUserId,
            provider: grantInput.provider,
            credential: grantInput.credential,
          });
          return { ...prepared.write, result: prepared.issued };
        },
      });
      if (!issued) {
        throw new Error("invalid_or_expired_link_intent");
      }
      return issued as DeviceAuthLinkGrant;
    },

    async exchangeDeviceAuthGrant(exchangeInput: {
      code: string;
      state: string;
      codeVerifier: string;
      redirectUri: string;
    }): Promise<DeviceAuthGrant | null> {
      const identifier = `${grantPrefix}${exchangeInput.code}`;
      const sealed = await input.store.consume({
        identifier,
        now: new Date(now()),
      });
      const record = openRecord(sealed, identifier, key, now());
      if (!record || record.kind !== "grant") return null;
      const grant = record.grant;
      if (
        !safeEqual(grant.state, exchangeInput.state) ||
        grant.redirectUri !== exchangeInput.redirectUri ||
        !safeEqual(
          grant.codeChallenge,
          sha256Base64Url(exchangeInput.codeVerifier),
        )
      ) {
        return null;
      }
      return grant;
    },
  };
}

let defaultService: ReturnType<typeof createDeviceAuthGrantService> | undefined;

function getDefaultService() {
  defaultService ??= createDeviceAuthGrantService({
    secret: readAccountAuthEnv().betterAuthSecret,
    store: createPostgresDeviceAuthRecordStore(),
  });
  return defaultService;
}

export async function issueDeviceAuthGrant(
  input: IssueGrantInput,
): Promise<DeviceAuthLoginGrant> {
  return getDefaultService().issueDeviceAuthGrant(input);
}

export async function issueDeviceAuthLinkIntent(input: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  betterAuthUserId: string;
  provider: DeviceAuthProvider;
}): Promise<DeviceAuthLinkIntent> {
  return getDefaultService().issueDeviceAuthLinkIntent(input);
}

export async function issueDeviceAuthLinkGrant(input: {
  linkIntent: string;
  state: string;
  redirectUri: string;
  provider: DeviceAuthProvider;
  credential: unknown;
}): Promise<DeviceAuthLinkGrant> {
  return getDefaultService().issueDeviceAuthLinkGrant(input);
}

export async function exchangeDeviceAuthGrant(input: {
  code: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<DeviceAuthGrant | null> {
  return getDefaultService().exchangeDeviceAuthGrant(input);
}

export function createPostgresDeviceAuthRecordStore(
  db: Db = getPool(),
  shouldSweep: () => boolean = () => Math.random() < EXPIRED_SWEEP_PROBABILITY,
  identifierPrefix: string = IDENTIFIER_PREFIX,
): DeviceAuthRecordStore {
  const ownedIdentifierPrefix = validateIdentifierPrefix(identifierPrefix);
  return {
    async write(input) {
      await db.query(
        `insert into ba_verifications
           (id, identifier, value, expires_at, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [randomUUID(), input.identifier, input.value, input.expiresAt],
      );
      await sweepExpiredDeviceAuthRecords(
        db,
        shouldSweep,
        ownedIdentifierPrefix,
      );
    },
    async consume(input) {
      const result = await db.query<ValueRow>(
        `delete from ba_verifications
          where identifier = $1 and expires_at > $2 returning value`,
        [input.identifier, input.now],
      );
      return result.rows[0]?.value ?? null;
    },
    async replace(input) {
      const client = await db.connect();
      try {
        await client.query("begin");
        const current = await client.query<ValueRow>(
          `select value from ba_verifications
            where identifier = $1 and expires_at > $2
            for update`,
          [input.identifier, input.now],
        );
        const value = current.rows[0]?.value;
        if (!value) {
          await client.query("rollback");
          return null;
        }
        const replacement = input.replacement(value);
        await client.query(
          `insert into ba_verifications
             (id, identifier, value, expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, now(), now())`,
          [
            randomUUID(),
            replacement.identifier,
            replacement.value,
            replacement.expiresAt,
          ],
        );
        await client.query(
          `delete from ba_verifications where identifier = $1`,
          [input.identifier],
        );
        await client.query("commit");
        await sweepExpiredDeviceAuthRecords(
          db,
          shouldSweep,
          ownedIdentifierPrefix,
        );
        return replacement.result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function sweepExpiredDeviceAuthRecords(
  db: Db,
  shouldSweep: () => boolean,
  identifierPrefix: string,
): Promise<void> {
  if (!shouldSweep()) return;
  await db
    .query(
      `delete from ba_verifications
        where identifier like $1 and expires_at <= now()`,
      [`${identifierPrefix}%`],
    )
    .catch(() => undefined);
}

function validateIdentifierPrefix(identifierPrefix: string): string {
  if (!/^aomi:device-auth:(?:[A-Za-z0-9-]+:)*$/.test(identifierPrefix)) {
    throw new Error("invalid_device_auth_identifier_prefix");
  }
  return identifierPrefix;
}

function sealRecord(
  record: StoredRecord,
  identifier: string,
  key: Buffer,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(identifier));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  return [
    ENVELOPE_VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function openRecord(
  sealed: string | null,
  identifier: string,
  key: Buffer,
  now: number,
): StoredRecord | null {
  if (!sealed) return null;
  try {
    const [version, nonce, ciphertext, tag, ...extra] = sealed.split(".");
    if (
      version !== ENVELOPE_VERSION ||
      !nonce ||
      !ciphertext ||
      !tag ||
      extra.length > 0
    ) {
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(identifier));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const record = JSON.parse(plaintext) as unknown;
    if (!isStoredRecord(record) || record.recordExpiresAt <= now) return null;
    return record;
  } catch {
    return null;
  }
}

function isStoredRecord(value: unknown): value is StoredRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.recordExpiresAt !== "number" ||
    !Number.isFinite(record.recordExpiresAt)
  ) {
    return false;
  }
  if (record.kind === "grant") return isDeviceAuthGrant(record.grant);
  if (record.kind === "link_intent") {
    return isDeviceAuthLinkIntent(record.intent);
  }
  return false;
}

function isDeviceAuthGrant(value: unknown): value is DeviceAuthGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as Record<string, unknown>;
  return (
    (grant.purpose === "login" || grant.purpose === "link") &&
    typeof grant.code === "string" &&
    typeof grant.state === "string" &&
    typeof grant.codeChallenge === "string" &&
    typeof grant.redirectUri === "string" &&
    typeof grant.createdAt === "number" &&
    (grant.provider === "para" || grant.provider === "privy") &&
    (grant.purpose === "login"
      ? typeof grant.sessionToken === "string"
      : grant.credential !== undefined)
  );
}

function isDeviceAuthLinkIntent(value: unknown): value is DeviceAuthLinkIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Record<string, unknown>;
  return (
    typeof intent.id === "string" &&
    typeof intent.state === "string" &&
    typeof intent.codeChallenge === "string" &&
    typeof intent.redirectUri === "string" &&
    typeof intent.betterAuthUserId === "string" &&
    typeof intent.createdAt === "number" &&
    (intent.provider === "para" || intent.provider === "privy")
  );
}

function validateState(state: string): void {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(state)) {
    throw new Error("invalid_state");
  }
}

function validateCodeChallenge(codeChallenge: string): void {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(codeChallenge)) {
    throw new Error("invalid_code_challenge");
  }
}

function validateLoopbackRedirectUri(redirectUri: string): void {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new Error("invalid_redirect_uri");
  }
  if (url.protocol !== "http:") throw new Error("invalid_redirect_uri");
  if (url.username || url.password) throw new Error("invalid_redirect_uri");
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("invalid_redirect_uri");
  }
  if (!/^\d{1,5}$/.test(url.port)) throw new Error("invalid_redirect_uri");
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("invalid_redirect_uri");
  }
  if (url.pathname !== "/callback") throw new Error("invalid_redirect_uri");
  if (url.search || url.hash) throw new Error("invalid_redirect_uri");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
