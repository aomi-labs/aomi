import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
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

/** `act`'s answer, or undefined for the error `code`. */
function unless<T>(code: string, act: () => T): T | undefined {
  try {
    return act();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== code) throw error;
    return undefined;
  }
}

/** Whether a lock's process is gone; only this machine's can be asked. */
function gone(pid: string, host: string): boolean {
  if (host !== hostname()) return false;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Run `write` as the only writer. The lock names its process and is taken over
 * only once that is gone: a paused one still writes when it goes on.
 */
function locked<T>(lock: string, write: (id: string) => T): T {
  const id = randomUUID();
  const own = `${lock}.${id}`;
  writeFileSync(own, `${process.pid}@${hostname()}@${id}`, {
    mode: 0o600,
    flag: "wx",
  });
  const held = () => unless("ENOENT", () => readFileSync(lock, "utf8"));
  const take = () => unless("EEXIST", () => (linkSync(own, lock), true));
  try {
    for (const until = Date.now() + 10_000; !take(); ) {
      const holder = held();
      const [pid, host, left] = holder?.split("@") ?? [];
      if (left && gone(pid!, host!))
        // Under its own lock, so that no one removes the next writer's.
        locked(`${lock}.${left}.gone`, () => {
          if (held() !== holder) return;
          rmSync(`${STATE_FILE}.${left}`, { force: true });
          rmSync(lock);
        });
      else if (Date.now() > until)
        throw new Error(
          `Another aomi is writing ${STATE_FILE}; if none is running, delete ${lock}`,
        );
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  } finally {
    rmSync(own, { force: true });
  }
  try {
    return write(id);
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Merge `patch` into the file as it is now; undefined removes a key. */
export function updateState(
  patch: Partial<CliState> | ((state: CliState) => Partial<CliState>),
): CliState {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  return locked(`${STATE_FILE}.lock`, (id) => {
    const state = loadState();
    const next = {
      ...state,
      ...(typeof patch === "function" ? patch(state) : patch),
    };
    const fresh = `${STATE_FILE}.${id}`;
    try {
      writeFileSync(fresh, `${JSON.stringify(next, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(fresh, STATE_FILE);
    } finally {
      rmSync(fresh, { force: true });
    }
    return next;
  });
}
