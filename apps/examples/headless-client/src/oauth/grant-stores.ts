import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { AomiOAuthGrant, AomiOAuthGrantStore } from "@aomi-labs/client";

type SecretValue = {
  read(): Promise<string | null | undefined>;
  /** Write null to remove the stored grant snapshot. */
  write(value: string | null): Promise<void>;
};

/**
 * A local-machine store for headless scripts. The parent directory and file
 * are owner-only, and each snapshot is replaced atomically.
 */
export function createJsonFileGrantStore(
  filePath: string,
): AomiOAuthGrantStore {
  const absolutePath = resolve(filePath);
  let pendingSave = Promise.resolve();
  return {
    async load() {
      try {
        return decodeGrantSnapshot(await readFile(absolutePath, "utf8"));
      } catch (error) {
        if (isNodeError(error, "ENOENT")) return [];
        throw error;
      }
    },
    async save(grants) {
      const snapshot = encodeGrantSnapshot(grants);
      const nextSave = pendingSave
        .catch(() => undefined)
        .then(() => saveSnapshot(absolutePath, snapshot));
      pendingSave = nextSave;
      await nextSave;
    },
  };
}

async function saveSnapshot(absolutePath: string, snapshot: string) {
  const directory = dirname(absolutePath);
  const createdDirectory = await mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });
  if (createdDirectory) await chmod(createdDirectory, 0o700);
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, snapshot, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, absolutePath);
    await chmod(absolutePath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Adapt a secret manager, OS keychain, encrypted database, or KMS-backed
 * service without coupling the SDK to a particular vendor. */
export function createSecretGrantStore(
  secret: SecretValue,
): AomiOAuthGrantStore {
  return {
    async load() {
      const value = await secret.read();
      return value ? decodeGrantSnapshot(value) : [];
    },
    async save(grants) {
      await secret.write(grants.length ? encodeGrantSnapshot(grants) : null);
    },
  };
}

export function encodeGrantSnapshot(grants: readonly AomiOAuthGrant[]): string {
  for (const grant of grants) {
    if (grant.tokenType === "DPoP" || grant.dpopProof) {
      throw new TypeError(
        "DPoP grants cannot be persisted without their non-exportable key",
      );
    }
  }
  return `${JSON.stringify({ version: 1, grants }, null, 2)}\n`;
}

export function decodeGrantSnapshot(value: string): AomiOAuthGrant[] {
  const snapshot: unknown = JSON.parse(value);
  if (
    !isRecord(snapshot) ||
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.grants)
  ) {
    throw new TypeError("Invalid Aomi OAuth grant snapshot");
  }
  return snapshot.grants.map((grant) => {
    if (!isPersistedGrant(grant)) {
      throw new TypeError("Invalid Aomi OAuth grant snapshot");
    }
    return { ...grant, scopes: [...grant.scopes] } as AomiOAuthGrant;
  });
}

function isPersistedGrant(value: unknown): value is AomiOAuthGrant {
  return (
    isRecord(value) &&
    typeof value.accessToken === "string" &&
    (value.refreshToken === undefined ||
      typeof value.refreshToken === "string") &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    typeof value.resource === "string" &&
    /^https?:\/\/[^/]+\/v1\/(agent|pipeline)$/.test(value.resource) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === "string") &&
    (value.tokenType === undefined || value.tokenType === "Bearer") &&
    typeof value.issuer === "string" &&
    typeof value.clientId === "string" &&
    (value.subject === undefined || typeof value.subject === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
