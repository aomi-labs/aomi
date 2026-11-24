import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import {
  Aomi,
  AomiError,
  CLIENT_TYPE_TS_CLI,
  createGuestSessionProvider,
  isMessageCommit,
  normalizeSolanaCluster,
  oauth,
  UserState,
  wallet,
  type AgentCard,
  type AomiAuthStrategy,
  type AgentTarget,
  type CommitView,
  type SvmCluster,
} from "@aomi-labs/client";
import { viemSigner } from "@aomi-labs/client/viem";
import { createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";
import { grants, loadState, updateState, type CliState } from "./state";

export const DEFAULT_BASE_URL = "https://aomi.chat";

/** Exit codes: 0 ok, 1 error, 2 usage, 3 needs approval or sign-in. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

/** One typed line; `otherwise` is the usage error without a terminal. */
export async function ask(text: string, otherwise: string): Promise<string> {
  if (!process.stdin.isTTY) throw usage(otherwise);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(text)).trim();
  } finally {
    rl.close();
  }
}

export const confirm = async (question: string): Promise<boolean> =>
  /^y(es)?$/i.test(
    await ask(`${question} [y/N] `, "Pass --yes outside a terminal"),
  );

export const usage = (message: string) => new CliError(message, 2);

/** What every command that talks to Aomi accepts. */
export type ConnectFlags = {
  backendUrl?: string;
  apiKey?: string;
  privateKey?: string;
  solanaPrivateKey?: string;
  cluster?: SvmCluster;
  rpcUrl?: string;
  chain?: number;
};

export const baseUrlOf = (flags: ConnectFlags, state = loadState()) =>
  (
    flags.backendUrl ??
    process.env.AOMI_BACKEND_URL ??
    state.baseUrl ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

/** Everything the CLI asks for at sign-in, so one approval covers it. */
const SCOPES = [
  "agent:read",
  "agent:write",
  "agent:actions:resolve",
  "pipeline:catalog",
  "pipeline:execute",
  "payments:submit",
  "account:packages:read",
  "account:packages:write",
  "account:credentials:read",
  "account:credentials:write",
  "account:transaction-safety:read",
  "account:transaction-safety:write",
  "account:credits:read",
  "account:credits:fund",
  "account:usage:read",
  "offline_access",
];

/** The saved device sign-in for this backend and its REST resource. */
async function heldGrant(baseUrl: string) {
  const issuer = `${baseUrl}/api/auth`;
  const resource = `${new URL(baseUrl).origin}/v1`;
  return (await grants.load()).find(
    (grant) => grant.issuer === issuer && grant.resource === resource,
  );
}

/** Where a sign-in shows its code: stderr, or a screen that draws it. */
export type ShowCode = (code: { url: string; code: string }) => void;

const codeOnStderr: ShowCode = ({ url, code }) => {
  process.stderr.write(`Open ${url}\nCode ${code}\n`);
};

/** The device sign-in, against the grants file. */
export async function deviceAuth(
  baseUrl: string,
  onCode: ShowCode = codeOnStderr,
): Promise<AomiAuthStrategy> {
  return oauth({
    clientName: `Aomi CLI · ${hostname()}`,
    scopes: SCOPES,
    store: grants,
    onCode,
    openBrowser: openUrl,
  });
}

async function signedIn(baseUrl: string): Promise<boolean> {
  return (await heldGrant(baseUrl)) !== undefined;
}

/** `--cluster`: any spelling of a Solana cluster. */
export function parseCluster(value: string): SvmCluster {
  const cluster = normalizeSolanaCluster(value);
  if (!cluster)
    throw usage(`Unknown cluster ${value}; use mainnet, devnet or testnet`);
  return cluster;
}

const clusterOf = (flags: { cluster?: SvmCluster }, state: CliState) =>
  flags.cluster ?? state.cluster ?? "solana:mainnet";

/** `--private-key` (or AOMI_PRIVATE_KEY): signs in headlessly and signs. */
export function privateKeyOf(flags: ConnectFlags): `0x${string}` | undefined {
  const key = (flags.privateKey ?? process.env.AOMI_PRIVATE_KEY)?.trim();
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    throw usage("--private-key must be a 0x-prefixed 32-byte hex key");
  return key as `0x${string}`;
}

/** `--solana-private-key` (or AOMI_SOLANA_PRIVATE_KEY): the same, by SIWS. */
const solanaKeyOf = (flags: ConnectFlags) =>
  (flags.solanaPrivateKey ?? process.env.AOMI_SOLANA_PRIVATE_KEY)?.trim() ||
  undefined;

/**
 * One `Aomi` for the command: signed in with `--private-key` (SIWE) or
 * `--solana-private-key` (SIWS), else with the device grant from
 * `aomi login`, else as a guest. The signer is the keys from the flags or
 * `aomi wallets signer set`.
 */
export async function connect(
  flags: ConnectFlags = {},
  onCode?: ShowCode,
): Promise<Aomi> {
  const state = loadState();
  const baseUrl = baseUrlOf(flags, state);
  const key = privateKeyOf(flags);
  const solanaKey = solanaKeyOf(flags);
  const evmKey = key ?? (state.evmKey as `0x${string}` | undefined);
  const svmKey = solanaKey ?? state.svmKey;
  const cluster = clusterOf(flags, state);
  // Each signs for any chain and sends on that chain's own RPC.
  const evmOn = (id: number, rpcUrl?: string) =>
    viemSigner(
      createWalletClient({
        account: privateKeyToAccount(evmKey!),
        chain: chainOf(id),
        transport: http(rpcUrl),
      }),
    );
  // Loaded only when used: @solana/web3.js is heavy and warns on import.
  const solana = svmKey ? await import("@aomi-labs/client/solana") : undefined;
  const svmOn = (id: SvmCluster, rpcUrl?: string) =>
    solana!.solanaSigner(svmKey!, {
      cluster: id,
      rpcUrls: rpcUrl ? { [id]: rpcUrl } : undefined,
    });
  const signer = {
    evm: evmKey
      ? {
          ...evmOn(flags.chain ?? state.chain ?? 1, flags.rpcUrl),
          broadcastTransaction: async (signed: string, id: number) =>
            evmOn(id, rpcOf(flags, "evm", String(id))).broadcastTransaction!(
              signed,
              id,
            ),
        }
      : undefined,
    svm: svmKey
      ? {
          ...svmOn(cluster),
          broadcastTransaction: async (signed: string, name: string) =>
            svmOn(parseCluster(name), rpcOf(flags, "svm", name))
              .broadcastTransaction!(signed, name),
        }
      : undefined,
  };
  const common = {
    baseUrl,
    apiKey: flags.apiKey ?? process.env.AOMI_API_KEY,
    ...(signer.evm || signer.svm ? { signer } : {}),
  };
  if (key)
    return new Aomi({
      ...common,
      auth: wallet(privateKeyToAccount(key), {
        chainId: flags.chain ?? state.chain,
      }),
    });
  if (solanaKey && signer.svm)
    return new Aomi({ ...common, auth: wallet(signer.svm) });
  if (await signedIn(baseUrl))
    return new Aomi({ ...common, auth: await deviceAuth(baseUrl, onCode) });
  return new Aomi({ ...common, guest: persistedGuest(baseUrl, state) });
}

/** Where public RPCs reach the chains the commits are on; elsewhere (a local
 * stack) they reach the real chain, which a signed copy would then be sent to. */
const PRODUCTION = new Set(["aomi.chat", "api.aomi.dev"]);

const chainKey = (family: string, ref: string) =>
  family === "svm" ? parseCluster(ref) : `eip155:${ref}`;

/** The RPC that sends on a chain; undefined is the public one. Saved per
 * backend, so a local stack never shares one with production. */
function rpcOf(
  flags: ConnectFlags,
  family: string,
  ref: string,
): string | undefined {
  const state = loadState();
  const base = baseUrlOf(flags, state);
  const url = flags.rpcUrl ?? state.rpc?.[base]?.[chainKey(family, ref)];
  if (!url && !PRODUCTION.has(new URL(base).hostname))
    throw new CliError(`No RPC for ${chainKey(family, ref)}: pass --rpc-url`);
  return url;
}

/** Each cluster by the start of its genesis hash, as CAIP-2 names it. */
const GENESIS: Record<string, SvmCluster> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana:mainnet",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: "solana:devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHScCKQY3": "solana:testnet",
};

/**
 * Before a local key signs what this machine then sends: an RPC for the
 * commit's chain (asked for with `missing` when there is none), kept once it
 * answers as that chain. Signed bytes it cannot send would hold the nonce.
 */
export async function rpcReady(
  flags: ConnectFlags,
  view: CommitView,
  missing: (chain: string) => Promise<string>,
): Promise<void> {
  if (view.broadcaster !== "wallet" || isMessageCommit(view)) return;
  const { chain_family: family, chain_ref: ref } = view;
  const chain = chainKey(family, ref);
  let url: string | undefined;
  try {
    url = rpcOf(flags, family, ref);
    if (!url) return;
  } catch {
    url = await missing(chain);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: family === "svm" ? "getGenesisHash" : "eth_chainId",
      params: [],
    }),
  })
    .then((answer) => answer.json() as Promise<{ result?: string }>)
    // Its URL may hold a key, so no error names it.
    .catch(() => undefined);
  const result = response?.result;
  if (!result) throw new CliError(`The RPC doesn't answer for ${chain}`);
  const is =
    family === "svm"
      ? // A local copy has a genesis of its own.
        (GENESIS[result.slice(0, 32)] ?? chain)
      : `eip155:${Number(result)}`;
  if (is !== chain)
    throw new CliError(`The RPC is on ${is}, the commit on ${chain}`);
  const state = loadState();
  const base = baseUrlOf(flags, state);
  updateState({
    rpc: { ...state.rpc, [base]: { ...state.rpc?.[base], [chain]: url } },
  });
}

/** The agents you can name, as the Portal has them: the one your agent key opens. */
export async function agentsOf(
  flags: ConnectFlags,
  aomi: Aomi,
): Promise<AgentCard[]> {
  const key = flags.apiKey ?? process.env.AOMI_API_KEY;
  return key
    ? aomi.raw.resolveAgentKey(key).then(
        (card) => [card],
        () => [],
      )
    : [];
}

/** The guest bearer outlives the process, so its threads stay reachable. */
function persistedGuest(baseUrl: string, state: CliState) {
  const fresh = createGuestSessionProvider({ baseUrl });
  let saved = state.guest?.baseUrl === baseUrl ? state.guest.token : null;
  return Object.assign(
    async (options?: { forceRefresh?: boolean }) => {
      if (saved && !options?.forceRefresh) return saved;
      saved = await fresh(options);
      if (saved) updateState({ guest: { baseUrl, token: saved } });
      return saved;
    },
    {
      clear() {
        fresh.clear();
        updateState({ guest: undefined });
      },
    },
  );
}

function chainOf(id: number): Chain {
  return (
    Object.values(chains).find((chain) => chain.id === id) ?? {
      id,
      name: `Chain ${id}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [] } },
    }
  );
}

/** What a turn runs with: the thread, `--agent` (else Auto), model and wallet. */
export function turnOptions(
  aomi: Aomi,
  state: CliState,
  overrides: {
    thread?: string;
    agent?: string;
    model?: string;
    chain?: number;
    cluster?: SvmCluster;
    /** A new thread's wallet per family (`/wallet` before the first turn). */
    walletPick?: { evm?: string; svm?: string };
  } = {},
) {
  const target: AgentTarget = { agent: overrides.agent };
  const evm = aomi.wallet?.evm?.address;
  const svm = aomi.wallet?.svm?.address;
  const chainId = overrides.chain ?? state.chain;
  const userState = UserState.withExt(
    {
      ...(evm
        ? { evm: { address: evm, ...(chainId ? { chain_id: chainId } : {}) } }
        : {}),
      ...(svm
        ? { svm: { address: svm, cluster: clusterOf(overrides, state) } }
        : {}),
      ...(evm || svm ? { connection: { is_connected: true } } : {}),
      ...(overrides.walletPick ? { wallet_pick: overrides.walletPick } : {}),
    },
    "client_type",
    CLIENT_TYPE_TS_CLI,
  );
  return {
    sessionId:
      overrides.thread ??
      (!state.owner || state.owner === ownerOf(aomi)
        ? state.thread
        : undefined) ??
      randomUUID(),
    target,
    model: overrides.model ?? state.model,
    clientId: clientIdOf(state),
    userState,
  };
}

/** This process's signer addresses, EVM first. */
export const signerAddresses = (aomi: Aomi) =>
  [aomi.wallet?.evm?.address, aomi.wallet?.svm?.address].filter(
    (address): address is string => Boolean(address),
  );

/** Who a thread belongs to: another sign-in can't continue it. */
export const ownerOf = (aomi: Aomi) =>
  aomi.auth.mode === "wallet"
    ? `wallet:${signerAddresses(aomi)[0]}`
    : aomi.auth.mode;

/** The secrets vault id, made once. */
export function clientIdOf(state = loadState()): string {
  if (state.clientId) return state.clientId;
  const clientId = randomUUID();
  updateState({ clientId });
  return clientId;
}

/** Decimal chain ids only: `base` or `8453abc` are usage errors. */
export function parseChain(value: string): number {
  if (!/^\d+$/.test(value.trim()))
    throw usage(
      `Invalid chain ID "${value}". Use a decimal chain ID, such as 8453.`,
    );
  return Number(value.trim());
}

export function openUrl(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore" })
    .on("error", () => undefined)
    .unref();
}

export const out = (line = ""): void => void process.stdout.write(`${line}\n`);
export const err = (line = ""): void => void process.stderr.write(`${line}\n`);
export const json = (value: unknown): void => out(JSON.stringify(value));

/** One line: the error, the server's reason, and what to do. */
export function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { details, hint } = error as {
    details?: { error?: { message?: string } };
    hint?: string;
  };
  const reason = details?.error?.message;
  return [error.message, reason, hint].filter(Boolean).join(": ");
}

/** An Aomi failure with the exit code it means here. */
export function exitCodeOf(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (
    error instanceof AomiError &&
    (error.status === 401 ||
      ["insufficient_scope", "interaction_required", "invalid_token"].includes(
        error.code,
      ))
  )
    return 3;
  return 1;
}
