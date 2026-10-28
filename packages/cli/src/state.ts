import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileGrants } from "@aomi-labs/client/node";
import type { AomiOAuthGrant } from "@aomi-labs/client";

export type SvmCluster = "solana:mainnet" | "solana:devnet" | "solana:testnet";

/** Everything the CLI remembers between runs, in one private file. */
export type CliState = {
  baseUrl?: string;
  /** The thread `aomi` continues. */
  thread?: string;
  model?: string;
  /** Direct app; none means Auto. */
  app?: string;
  chain?: number;
  /** The secrets vault client (`aomi secret`, `aomi keys`). */
  clientId?: string;
  /** The guest bearer, and the backend it belongs to. */
  guest?: { baseUrl: string; token: string };
  /** Local signer keys (`aomi wallets signer set`). */
  evmKey?: string;
  svmKey?: string;
  cluster?: SvmCluster;
};

export const STATE_DIR = process.env.AOMI_STATE_DIR ?? join(homedir(), ".aomi");
const STATE_FILE = join(STATE_DIR, "cli.json");
export const grants = fileGrants(join(STATE_DIR, "grants.json"));

export function loadState(): CliState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as CliState;
  } catch {
    return existsSync(STATE_FILE) ? {} : migrate();
  }
}

export function saveState(state: CliState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function updateState(patch: Partial<CliState>): CliState {
  const next = { ...loadState(), ...patch };
  for (const key of Object.keys(patch) as (keyof CliState)[])
    if (patch[key] === undefined) delete next[key];
  saveState(next);
  return next;
}

type OldSession = {
  sessionId?: string;
  baseUrl?: string;
  model?: string;
  app?: string;
  agentMode?: string;
  chainId?: number;
  clientId?: string;
  guestBearer?: string;
  privateKey?: string;
  svmPrivateKey?: string;
  svmCluster?: SvmCluster;
  auth?: unknown;
  accountBearer?: string;
  oauthGrants?: Record<string, Omit<AomiOAuthGrant, "issuer">>;
};

/** Read the 0.2 active session once: its thread, settings, keys and grants. */
function migrate(): CliState {
  let old: OldSession;
  try {
    const id = readFileSync(join(STATE_DIR, "active-session.txt"), "utf8");
    old = JSON.parse(
      readFileSync(
        join(STATE_DIR, "sessions", `session-${id.trim()}.json`),
        "utf8",
      ),
    ) as OldSession;
  } catch {
    return {};
  }
  const state: CliState = {
    baseUrl: old.baseUrl,
    thread: old.sessionId,
    model: old.model,
    app: old.agentMode === "auto" ? undefined : old.app,
    chain: old.chainId,
    clientId: old.clientId,
    guest:
      old.guestBearer && old.baseUrl
        ? { baseUrl: old.baseUrl, token: old.guestBearer }
        : undefined,
    evmKey: old.privateKey,
    svmKey: old.svmPrivateKey,
    cluster: old.svmCluster,
  };
  const oldGrants = Object.values(old.oauthGrants ?? {});
  if (oldGrants.length && old.baseUrl) {
    // 0.2 grants lack only the issuer, which is the portal's auth path.
    const issuer = `${old.baseUrl.replace(/\/+$/, "")}/api/auth`;
    void grants.save(oldGrants.map((grant) => ({ ...grant, issuer })));
  } else if (old.auth || old.accountBearer) {
    process.stderr.write("sign in again: aomi login\n");
  }
  saveState(state);
  return state;
}
