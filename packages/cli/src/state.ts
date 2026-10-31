import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileGrants } from "@aomi-labs/client/node";

export type SvmCluster = "solana:mainnet" | "solana:devnet" | "solana:testnet";

/** Everything the CLI remembers between runs, in one private file. */
export type CliState = {
  baseUrl?: string;
  /** The thread `aomi` continues, and who started it (see `ownerOf`). */
  thread?: string;
  owner?: string;
  model?: string;
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

const STATE_DIR = process.env.AOMI_STATE_DIR ?? join(homedir(), ".aomi");
const STATE_FILE = join(STATE_DIR, "cli.json");
export const grants = fileGrants(join(STATE_DIR, "grants.json"));

export function loadState(): CliState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as CliState;
  } catch {
    return {};
  }
}

function saveState(state: CliState): void {
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

