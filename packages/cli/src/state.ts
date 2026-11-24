import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SvmCluster } from "@aomi-labs/client";
import { fileGrants } from "@aomi-labs/client/node";

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
  /** The RPC per chain (`eip155:8453`, `solana:mainnet`), by backend. */
  rpc?: Record<string, Record<string, string>>;
};

const STATE_DIR = process.env.AOMI_STATE_DIR ?? join(homedir(), ".aomi");
const STATE_FILE = join(STATE_DIR, "cli.json");
export const grants = fileGrants(join(STATE_DIR, "grants.json"));

/** A file that isn't this state (a bad edit, a half restore) is never replaced. */
export function loadState(): CliState {
  let text: string;
  try {
    text = readFileSync(STATE_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let state: unknown;
  try {
    state = JSON.parse(text);
  } catch {
    // Its text may hold keys, so the parser's message stays here.
  }
  if (!state || typeof state !== "object" || Array.isArray(state))
    throw new Error(`${STATE_FILE} is not valid; fix it or move it away`);
  return state as CliState;
}

/** Run `write` as the only writer; a lock its process left is taken over. */
function locked<T>(write: () => T): T {
  const lock = `${STATE_FILE}.lock`;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx", 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const since = statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
    if (since && Date.now() - since > 5000) rmSync(lock, { force: true });
    else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  try {
    return write();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Merge `patch` into the file as it is now; undefined removes a key. */
export function updateState(
  patch: Partial<CliState> | ((state: CliState) => Partial<CliState>),
): CliState {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  return locked(() => {
    const state = loadState();
    const next = {
      ...state,
      ...(typeof patch === "function" ? patch(state) : patch),
    };
    const fresh = `${STATE_FILE}.new`;
    rmSync(fresh, { force: true });
    writeFileSync(fresh, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(fresh, STATE_FILE);
    return next;
  });
}
