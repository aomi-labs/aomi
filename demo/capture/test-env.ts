/**
 * Orchestration around product-mono's `aomi test-env` anvil-fork harness.
 *
 * We do not spawn anvil ourselves — `aomi test-env` already owns the fork
 * lifecycle, pre-funding, and detached process management. This module only
 * reads its state and turns it into the env vars the portal needs.
 *
 * SAFETY: read `assertForkedOrDie` before changing anything here.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TEST_ENV_DIR = join(homedir(), ".aomi", "test-env");
const PIDS_PATH = join(TEST_ENV_DIR, "pids.json");

/**
 * Which `aomi` to shell out to.
 *
 * The released CLI on PATH (homebrew, v0.3.9) does NOT carry the `test-env`
 * command group — it answers "Unknown command test-env". Only a build from
 * product-mono source has it, so default to that and let AOMI_BIN override.
 */
const AOMI_BIN =
  process.env.AOMI_BIN ??
  join(
    homedir(),
    "Code",
    "product-mono",
    "aomi",
    "target",
    "debug",
    "aomi-cli",
  );

export type ForkedChain = {
  chainId: number;
  port: number;
  rpcUrl: string;
};

/**
 * `pids.json` is written by product-mono's `test_env/evm/state.rs`. We read it
 * rather than parsing `aomi test-env evm status` output because a file schema is
 * a more stable contract than human-facing CLI text.
 *
 * Verified against a live `test-env evm up --chains 1` on 2026-07-31:
 *
 *   { "version": 1, "started_at": 1785472012,
 *     "proxies": [ { "chain_id": 1, "pid": 76737, "port": 51610,
 *                    "endpoint": "http://127.0.0.1:51610",
 *                    "fork_url": "...", "name": "ethereum" } ] }
 *
 * `endpoint` is authoritative — prefer it over rebuilding the URL from `port`,
 * so a future bind-address change does not silently point us at the wrong host.
 */
function parsePids(raw: string): ForkedChain[] {
  const parsed = JSON.parse(raw) as { proxies?: unknown };
  const proxies = Array.isArray(parsed.proxies) ? parsed.proxies : [];

  const chains: ForkedChain[] = [];
  for (const proxy of proxies) {
    const record = (proxy ?? {}) as Record<string, unknown>;
    const chainId = Number(record.chain_id);
    const port = Number(record.port);
    if (!Number.isInteger(chainId) || chainId <= 0) continue;
    if (!Number.isInteger(port) || port <= 0) continue;
    const endpoint =
      typeof record.endpoint === "string" && record.endpoint.length > 0
        ? record.endpoint
        : `http://127.0.0.1:${port}`;
    chains.push({ chainId, port, rpcUrl: endpoint });
  }

  if (chains.length === 0) {
    throw new Error(
      `Could not read any chain/port pairs from ${PIDS_PATH}.\n` +
        `Expected a "proxies" array of {chain_id, port, endpoint}.\n` +
        `Raw contents:\n${raw}\n\n` +
        `If product-mono changed this file's schema, update parsePids().`,
    );
  }
  return chains;
}

export async function readForkedChains(): Promise<ForkedChain[]> {
  let raw: string;
  try {
    raw = await readFile(PIDS_PATH, "utf8");
  } catch {
    throw new Error(
      `No fork state at ${PIDS_PATH}. Start the harness first:\n\n` +
        `  FULL_TESTNETS=true ALCHEMY_API_KEY=... ${AOMI_BIN} test-env evm up --chains 1\n\n` +
        `(The homebrew \`aomi\` on PATH has no test-env command — build it from ` +
        `product-mono, or set AOMI_BIN.)\n`,
    );
  }
  return parsePids(raw);
}

/** Build the value for NEXT_PUBLIC_FULL_TESTNET_RPC_MAP (JSON form). */
export function toRpcMap(chains: readonly ForkedChain[]): string {
  return JSON.stringify(
    Object.fromEntries(chains.map((c) => [String(c.chainId), c.rpcUrl])),
  );
}

/**
 * Refork one chain so every take starts from identical state. This is what
 * makes takes repeatable — without it, take 2 inherits take 1's transactions.
 */
export async function resetChain(chainId: number): Promise<void> {
  // Note the `evm` layer: the real command is `aomi test-env evm reset`, not
  // `aomi test-env reset` as product-mono's full-testnet.md shows. Verified
  // against aomi/bin/cli/src/cli.rs (TestEnvEvmCommand).
  await execFileAsync(
    AOMI_BIN,
    ["test-env", "evm", "reset", "--chain", String(chainId)],
    { env: { ...process.env, FULL_TESTNETS: "true" } },
  );
}

/**
 * Hard preflight. Do not remove, and do not downgrade to a warning.
 *
 * The portal's full-testnet routing fails OPEN: if NEXT_PUBLIC_USE_FULL_TESTNET
 * is unset or the RPC map does not parse, `isFullTestnet()` returns false and
 * the app quietly falls back to real mainnet RPCs. Our scenario prompts tell the
 * agent to stake, swap and bridge. Running them against a funded wallet on real
 * mainnet would spend real money while looking exactly like a successful take.
 *
 * So: prove the fork is live and answering before any scenario is allowed to run.
 */
export async function assertForkedOrDie(
  chains: readonly ForkedChain[],
): Promise<void> {
  if (chains.length === 0) {
    throw new Error("Refusing to record: no forked chains detected.");
  }

  for (const chain of chains) {
    const response = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_nodeInfo",
        params: [],
      }),
    }).catch(() => null);

    if (!response?.ok) {
      throw new Error(
        `Refusing to record: chain ${chain.chainId} at ${chain.rpcUrl} did not respond.`,
      );
    }

    // `anvil_nodeInfo` only exists on anvil. A real RPC returns a JSON-RPC
    // error for it, which is precisely the signal we want to catch.
    const body = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    };
    if (body.error || !body.result) {
      throw new Error(
        `Refusing to record: ${chain.rpcUrl} answered but is NOT an anvil fork ` +
          `(anvil_nodeInfo rejected). This is the failure mode that spends real money.`,
      );
    }
  }
}

/**
 * Current block height on a fork.
 *
 * This is how we prove a take actually executed on-chain. We cannot watch
 * backend→fork traffic from the browser (the agent's tools run server-side), so
 * "did the chain move?" is the only honest client-side signal that a scenario
 * did more than talk.
 */
export async function blockNumber(chain: ForkedChain): Promise<number> {
  const response = await fetch(chain.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: [],
    }),
  });
  const body = (await response.json()) as { result?: string };
  return Number.parseInt(body.result ?? "0x0", 16);
}

async function rpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error) {
    throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

/** Give an address native ETH. `wei` is a hex quantity. */
export async function setBalance(
  chain: ForkedChain,
  address: string,
  wei: string,
): Promise<void> {
  await rpc(chain.rpcUrl, "anvil_setBalance", [address, wei]);
}

/**
 * Wipe any code at an address — the EIP-7702 booby-trap guard.
 *
 * The anvil mnemonic accounts (including the demo wallet, account 2) are
 * publicly-compromised keys, and on REAL mainnet + Base they carry 7702
 * delegations (`0xef0100…`) to sweeper contracts. Outbound txs and ERC-20
 * receipts are unaffected — which is why staking/Aave takes never noticed —
 * but native ETH delivered BY CONTRACT CALL executes the delegate and gets
 * swept inside the same transaction. A bridge fill is exactly that call:
 * the first Across fill smoke "succeeded" while the recipient's balance
 * stayed flat, the ETH stolen in-tx by the sweeper the fork inherited.
 * Discovered live on 2026-08-01; runs after every reset because a refork
 * re-inherits the delegation from upstream.
 */
export async function wipeAccountCode(
  chain: ForkedChain,
  address: string,
): Promise<void> {
  await rpc(chain.rpcUrl, "anvil_setCode", [address, "0x"]);
}

/** Native balance in wei. */
export async function nativeBalance(
  chain: ForkedChain,
  address: string,
): Promise<bigint> {
  const result = await rpc(chain.rpcUrl, "eth_getBalance", [address, "latest"]);
  return BigInt((result as string) ?? "0x0");
}

/**
 * Chain-actor daemon lifecycle (`aomi test-env actors …`) — the mock
 * off-chain counterparties (Across relayer first) that make cross-chain
 * takes completable on forks. Start AFTER reset + funding: the daemon's
 * block cursors begin at the current head, and a reset can respawn forks
 * on new ports, which would strand a daemon started earlier.
 */
export async function actorsUp(
  actors: readonly string[],
  fillDelayMs: number,
): Promise<void> {
  await execFileAsync(
    AOMI_BIN,
    [
      "test-env",
      "actors",
      "up",
      "--actors",
      actors.join(","),
      "--fill-delay-ms",
      String(fillDelayMs),
    ],
    { env: { ...process.env, FULL_TESTNETS: "true" } },
  );
}

/** Best-effort stop — also used to clear a stale daemon before `actorsUp`. */
export async function actorsDown(): Promise<void> {
  await execFileAsync(AOMI_BIN, ["test-env", "actors", "down"], {
    env: { ...process.env, FULL_TESTNETS: "true" },
  }).catch(() => {
    // No daemon (or no state file) is exactly the state we want.
  });
}

/**
 * Force the backend's SIM forks to re-fork from their proxies.
 *
 * The backend the agent READS through spawns one sim anvil per chain,
 * forking from our proxy at BACKEND BOOT — and in the demo backend's mode
 * the per-instance refork tasks never start (its log has zero "Starting
 * per-instance refork task" lines), so the sim stays frozen on whatever
 * the proxy held at boot. That state is the anvil 10,000 ETH prefund, and
 * the agent has proposed "bridge 1,000 ETH" off it — measured live on
 * 2026-08-02: proxy 10 ETH (seeded), sim 10,000 ETH (boot snapshot).
 *
 * The sims are discoverable: they are the anvil processes whose
 * `--fork-url` points at our proxy endpoints. `anvil_reset` with that
 * same fork url re-forks them against the CURRENT (post-seed) proxy
 * state. Runs after every seeding pass; a sim that has vanished is
 * skipped (the backend will respawn it on its own terms).
 *
 * CRITICAL caveat, measured 2026-08-02: `anvil_reset` re-applies anvil's
 * OWN genesis prefund — the 10 mnemonic dev accounts read 10,000 ETH on
 * the sim regardless of what the proxy holds, because local account
 * state shadows forked state. ERC-20 balances fork through fine (no
 * prefund shadows them); NATIVE balances of dev accounts do not. So this
 * returns the sim endpoints as `ForkedChain`s and the CALLER must
 * re-apply the demo wallet's native balances (and code wipe) to each sim
 * mirror, exactly as it did to the proxy. Skipping that refresh
 * is how an agent came to stake 5,000 ETH of a 10 ETH wallet.
 */
export async function resyncSimForks(
  chains: readonly ForkedChain[],
): Promise<ForkedChain[]> {
  const { stdout } = await execFileAsync("ps", ["axww", "-o", "command"]);
  const sims: ForkedChain[] = [];
  for (const chain of chains) {
    const pattern = new RegExp(
      `anvil --port (\\d+) [^\\n]*--fork-url ${chain.rpcUrl.replace(/[/.:]/g, "\\$&")}(?:\\s|/|$)`,
      "g",
    );
    for (const match of stdout.matchAll(pattern)) {
      const simPort = Number(match[1]);
      if (!Number.isInteger(simPort) || simPort === chain.port) continue;
      await rpc(`http://127.0.0.1:${simPort}`, "anvil_reset", [
        { forking: { jsonRpcUrl: chain.rpcUrl } },
      ]).then(
        () => {
          console.log(
            `resynced sim fork :${simPort} from chain ${chain.chainId}`,
          );
          sims.push({
            chainId: chain.chainId,
            port: simPort,
            rpcUrl: `http://127.0.0.1:${simPort}`,
          });
        },
        (error) =>
          console.warn(
            `sim resync :${simPort} failed (${String(error)}); backend reads may be stale`,
          ),
      );
    }
  }
  return sims;
}

/**
 * Move ERC-20 balance to the demo wallet by impersonating a holder.
 *
 * `anvil_setBalance` only moves native ETH, and writing the token's balance
 * storage slot directly means knowing each token's layout. Impersonating a
 * holder and calling `transfer` is layout-agnostic and reads as a normal
 * transfer to anything inspecting the chain afterwards.
 *
 * The holder is topped up with gas first — a faucet wallet has ETH, but a
 * whale plucked off mainnet may have none on the fork.
 */
export async function seedErc20(
  chain: ForkedChain,
  token: string,
  holder: string,
  recipient: string,
  amount: string,
): Promise<void> {
  const transferCall =
    "0xa9059cbb" +
    recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0") +
    BigInt(amount).toString(16).padStart(64, "0");

  await setBalance(chain, holder, "0xDE0B6B3A7640000"); // 1 ETH for gas
  await rpc(chain.rpcUrl, "anvil_impersonateAccount", [holder]);
  try {
    await rpc(chain.rpcUrl, "eth_sendTransaction", [
      { from: holder, to: token, data: transferCall },
    ]);
  } finally {
    await rpc(chain.rpcUrl, "anvil_stopImpersonatingAccount", [holder]);
  }
}

/** ERC-20 `balanceOf`, as a decimal string of base units. */
export async function erc20BalanceOf(
  chain: ForkedChain,
  token: string,
  address: string,
): Promise<bigint> {
  const data =
    "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const result = await rpc(chain.rpcUrl, "eth_call", [
    { to: token, data },
    "latest",
  ]);
  return BigInt((result as string) ?? "0x0");
}

/**
 * Env overrides the portal dev server needs to route at the fork.
 *
 * Returns a plain record rather than NodeJS.ProcessEnv: this repo's ProcessEnv
 * is augmented with a required NODE_ENV, so the literal below does not satisfy
 * it — and these are overrides meant to be spread onto process.env, not a
 * complete environment.
 */
export function portalEnv(
  chains: readonly ForkedChain[],
): Record<string, string> {
  return {
    NEXT_PUBLIC_USE_FULL_TESTNET: "true",
    NEXT_PUBLIC_FULL_TESTNET_RPC_MAP: toRpcMap(chains),
  };
}
