import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { AomiOAuthResource } from "../authorization";

export type CliAuthSession = {
  sessionToken: string;
  expiresAt: number;
  walletFamily?: "evm" | "svm";
  walletAddress?: string;
  chainId?: number;
  chainScope?: string;
  betterAuthUserId?: string;
};

export type CliOAuthGrant = {
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  resource: AomiOAuthResource;
  scopes: readonly string[];
  tokenType?: "Bearer" | "DPoP";
};

export type CliSessionState = {
  sessionId: string;
  clientId?: string;
  baseUrl: string;
  app?: string;
  model?: string;
  /** Whether the active model has been pushed to the backend session. */
  modelSynced?: boolean;
  apiKey?: string;
  /** Aomi account bearer for authenticated requests. Persisted so a bearer
   * supplied once (via `--account-bearer`) survives across CLI invocations. */
  accountBearer?: string;
  /** Better Auth anonymous bearer owning guest Agent sessions. Stored in the
   * same private state file so a later CLI process can resume that identity. */
  guestBearer?: string;
  publicKey?: string;
  privateKey?: string;
  /** Solana public key (base58), derived from the Solana keypair when provided. */
  svmPublicKey?: string;
  /** Canonical CAIP-2 Solana cluster selected for this session. */
  svmCluster?: "solana:mainnet" | "solana:devnet" | "solana:testnet";
  /** Solana private key (base58), persisted by `wallet set --solana`. Used as
   * the signing key fallback when `--solana-private-key` is not passed on a
   * command. Never printed in output. */
  svmPrivateKey?: string;
  chainId?: number;
  secretHandles?: Record<string, string>;
  auth?: CliAuthSession;
  oauthGrants?: Record<string, CliOAuthGrant>;
};

type StoredSessionState = CliSessionState & {
  localId: number;
  createdAt: number;
  updatedAt: number;
};

export type StoredSessionRecord = {
  localId: number;
  sessionId: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  state: CliSessionState;
};

const SESSION_FILE_PREFIX = "session-";
const SESSION_FILE_SUFFIX = ".json";
const STATE_DIR_MODE = 0o700;
const STATE_FILE_MODE = 0o600;

export const STATE_ROOT_DIR =
  process.env.AOMI_STATE_DIR ?? join(homedir(), ".aomi");
export const SESSIONS_DIR = join(STATE_ROOT_DIR, "sessions");
const ACTIVE_SESSION_FILE = join(STATE_ROOT_DIR, "active-session.txt");

function ensureStorageDirs(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: STATE_DIR_MODE });
  try {
    chmodSync(STATE_ROOT_DIR, STATE_DIR_MODE);
    chmodSync(SESSIONS_DIR, STATE_DIR_MODE);
  } catch {
    // Best effort only; writes still proceed so the CLI remains usable.
  }
}

function parseSessionFileLocalId(filename: string): number | null {
  const match = filename.match(/^session-(\d+)\.json$/);
  if (!match) return null;
  const localId = parseInt(match[1], 10);
  return Number.isNaN(localId) ? null : localId;
}

function toSessionFilePath(localId: number): string {
  return join(
    SESSIONS_DIR,
    `${SESSION_FILE_PREFIX}${localId}${SESSION_FILE_SUFFIX}`,
  );
}

function toCliSessionState(stored: StoredSessionState): CliSessionState {
  return {
    sessionId: stored.sessionId,
    clientId: stored.clientId,
    baseUrl: stored.baseUrl,
    app: stored.app,
    model: stored.model,
    modelSynced: stored.modelSynced,
    apiKey: stored.apiKey,
    accountBearer: stored.accountBearer,
    guestBearer: stored.guestBearer,
    publicKey: stored.publicKey,
    privateKey: stored.privateKey,
    svmPublicKey: stored.svmPublicKey,
    svmCluster: stored.svmCluster,
    svmPrivateKey: stored.svmPrivateKey,
    chainId: stored.chainId,
    secretHandles: stored.secretHandles,
    auth: stored.auth,
    oauthGrants: stored.oauthGrants,
  };
}

function readStoredSession(path: string): StoredSessionState | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredSessionState>;

    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.baseUrl !== "string"
    ) {
      return null;
    }

    const fallbackLocalId = parseSessionFileLocalId(basename(path)) ?? 0;
    return {
      sessionId: parsed.sessionId,
      clientId: parsed.clientId,
      baseUrl: parsed.baseUrl,
      app: parsed.app,
      model: parsed.model,
      modelSynced: parsed.modelSynced,
      apiKey: parsed.apiKey,
      accountBearer: parsed.accountBearer,
      guestBearer:
        typeof parsed.guestBearer === "string" && parsed.guestBearer
          ? parsed.guestBearer
          : undefined,
      publicKey: parsed.publicKey,
      privateKey: parsed.privateKey,
      svmPublicKey: parsed.svmPublicKey,
      svmCluster: parsed.svmCluster,
      svmPrivateKey: parsed.svmPrivateKey,
      chainId: parsed.chainId,
      secretHandles: parsed.secretHandles,
      auth: normalizeAuthSession(parsed.auth),
      oauthGrants: normalizeOAuthGrants(parsed.oauthGrants),
      localId:
        typeof parsed.localId === "number" && parsed.localId > 0
          ? parsed.localId
          : fallbackLocalId,
      createdAt:
        typeof parsed.createdAt === "number" && parsed.createdAt > 0
          ? parsed.createdAt
          : Date.now(),
      updatedAt:
        typeof parsed.updatedAt === "number" && parsed.updatedAt > 0
          ? parsed.updatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

function normalizeAuthSession(value: unknown): CliAuthSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const auth = value as Partial<CliAuthSession>;
  if (
    typeof auth.sessionToken !== "string" ||
    !auth.sessionToken ||
    typeof auth.expiresAt !== "number" ||
    !Number.isFinite(auth.expiresAt)
  ) {
    return undefined;
  }
  return {
    sessionToken: auth.sessionToken,
    expiresAt: auth.expiresAt,
    walletFamily: auth.walletFamily,
    walletAddress: auth.walletAddress,
    chainId: auth.chainId,
    chainScope: auth.chainScope,
    betterAuthUserId: auth.betterAuthUserId,
  };
}

function normalizeOAuthGrants(
  value: unknown,
): Record<string, CliOAuthGrant> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const grants: Record<string, CliOAuthGrant> = {};
  for (const candidate of Object.values(
    value as Record<string, Partial<CliOAuthGrant>>,
  )) {
    if (
      typeof candidate.clientId !== "string" ||
      !candidate.clientId ||
      typeof candidate.accessToken !== "string" ||
      !candidate.accessToken ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isFinite(candidate.expiresAt) ||
      typeof candidate.resource !== "string" ||
      !/\/v1\/(agent|pipeline)$/.test(candidate.resource) ||
      !Array.isArray(candidate.scopes) ||
      !candidate.scopes.every((scope) => typeof scope === "string") ||
      (candidate.tokenType !== undefined &&
        candidate.tokenType !== "Bearer" &&
        candidate.tokenType !== "DPoP")
    ) {
      continue;
    }
    const grant = candidate as CliOAuthGrant;
    grants[grant.resource] = grant;
  }
  return Object.keys(grants).length > 0 ? grants : undefined;
}

function readActiveLocalId(): number | null {
  try {
    if (!existsSync(ACTIVE_SESSION_FILE)) return null;
    const raw = readFileSync(ACTIVE_SESSION_FILE, "utf-8").trim();
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function writeActiveLocalId(localId: number | null): void {
  try {
    if (localId === null) {
      if (existsSync(ACTIVE_SESSION_FILE)) {
        rmSync(ACTIVE_SESSION_FILE);
      }
      return;
    }
    ensureStorageDirs();
    writeFileSync(ACTIVE_SESSION_FILE, String(localId), {
      mode: STATE_FILE_MODE,
    });
    try {
      chmodSync(ACTIVE_SESSION_FILE, STATE_FILE_MODE);
    } catch {
      // Best-effort hardening only.
    }
  } catch {
    // Ignore active pointer write failures.
  }
}

function readAllStoredSessions(): StoredSessionState[] {
  try {
    ensureStorageDirs();
    const filenames = readdirSync(SESSIONS_DIR)
      .map((name) => ({ name, localId: parseSessionFileLocalId(name) }))
      .filter(
        (entry): entry is { name: string; localId: number } =>
          entry.localId !== null,
      )
      .sort((a, b) => a.localId - b.localId);

    const sessions: StoredSessionState[] = [];
    for (const entry of filenames) {
      const path = join(SESSIONS_DIR, entry.name);
      const stored = readStoredSession(path);
      if (stored) {
        sessions.push(stored);
      }
    }

    return sessions;
  } catch {
    return [];
  }
}

function getNextLocalId(sessions: StoredSessionState[]): number {
  const maxLocalId = sessions.reduce((max, session) => {
    return session.localId > max ? session.localId : max;
  }, 0);
  return maxLocalId + 1;
}

function resolveStoredSession(
  selector: string,
  sessions: StoredSessionState[],
): StoredSessionState | null {
  const trimmed = selector.trim();
  if (!trimmed) return null;

  const localMatch = trimmed.match(/^(?:session-)?(\d+)$/);
  if (localMatch) {
    const localId = parseInt(localMatch[1], 10);
    if (!Number.isNaN(localId)) {
      return sessions.find((session) => session.localId === localId) ?? null;
    }
  }

  return sessions.find((session) => session.sessionId === trimmed) ?? null;
}

function toStoredSessionRecord(
  stored: StoredSessionState,
): StoredSessionRecord {
  return {
    localId: stored.localId,
    sessionId: stored.sessionId,
    path: toSessionFilePath(stored.localId),
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    state: toCliSessionState(stored),
  };
}

export function getActiveStateFilePath(): string | null {
  const sessions = readAllStoredSessions();
  const activeLocalId = readActiveLocalId();
  if (activeLocalId === null) return null;
  const active = sessions.find((session) => session.localId === activeLocalId);
  return active ? toSessionFilePath(active.localId) : null;
}

export function listStoredSessions(): StoredSessionRecord[] {
  return readAllStoredSessions().map(toStoredSessionRecord);
}

export function setActiveSession(selector: string): StoredSessionRecord | null {
  const sessions = readAllStoredSessions();
  const target = resolveStoredSession(selector, sessions);
  if (!target) return null;
  writeActiveLocalId(target.localId);
  return toStoredSessionRecord(target);
}

export function deleteStoredSession(
  selector: string,
): StoredSessionRecord | null {
  const sessions = readAllStoredSessions();
  const target = resolveStoredSession(selector, sessions);
  if (!target) return null;

  const targetPath = toSessionFilePath(target.localId);
  try {
    if (existsSync(targetPath)) {
      rmSync(targetPath);
    }
  } catch {
    return null;
  }

  const activeLocalId = readActiveLocalId();
  if (activeLocalId === target.localId) {
    const remaining = readAllStoredSessions().sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    writeActiveLocalId(remaining[0]?.localId ?? null);
  }

  return toStoredSessionRecord(target);
}

export function readState(): CliSessionState | null {
  const sessions = readAllStoredSessions();
  if (sessions.length === 0) return null;

  const activeLocalId = readActiveLocalId();
  if (activeLocalId === null) {
    return null;
  }

  const active =
    sessions.find((session) => session.localId === activeLocalId) ?? null;
  if (!active) {
    writeActiveLocalId(null);
    return null;
  }

  return toCliSessionState(active);
}

export function writeState(state: CliSessionState): void {
  ensureStorageDirs();

  const sessions = readAllStoredSessions();
  const existing = sessions.find(
    (session) => session.sessionId === state.sessionId,
  );

  const now = Date.now();
  const localId = existing?.localId ?? getNextLocalId(sessions);
  const createdAt = existing?.createdAt ?? now;

  const payload: StoredSessionState = {
    ...state,
    localId,
    createdAt,
    updatedAt: now,
  };

  const stateFilePath = toSessionFilePath(localId);
  writeFileSync(stateFilePath, JSON.stringify(payload, null, 2), {
    mode: STATE_FILE_MODE,
  });
  try {
    chmodSync(stateFilePath, STATE_FILE_MODE);
  } catch {
    // Best-effort hardening only.
  }
  writeActiveLocalId(localId);
}

export function clearState(): void {
  writeActiveLocalId(null);
}
