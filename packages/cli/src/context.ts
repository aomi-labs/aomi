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
  type AomiWalletStrategy,
  type AgentTarget,
  type CommitRefView,
  type SvmCluster,
} from "@aomi-labs/client";
import { viemSigner } from "@aomi-labs/client/viem";
import { createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";
import { grants, loadState, updateState, type CliState } from "./state";
import { plain, plainText } from "./trace";

export const DEFAULT_BASE_URL = "https://aomi.chat";

/** Exit codes: 0 ok, 1 error, 2 usage, 3 needs approval or sign-in, 4 pending. */
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
  const rpc: Sending["rpc"] = new Map();
  const rpcOn = (chain: string) => {
    if (!rpc.has(chain)) throw new CliError(`No RPC checked for ${chain}`);
    return rpc.get(chain);
  };
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
          ...evmOn(flags.chain ?? state.chain ?? 1),
          broadcastTransaction: (signed: string, id: number) =>
            sent(async () =>
              evmOn(id, rpcOn(`eip155:${id}`)).broadcastTransaction!(
                signed,
                id,
              ),
            ),
        }
      : undefined,
    svm: svmKey
      ? {
          ...svmOn(cluster),
          broadcastTransaction: (signed: string, name: string) =>
            sent(async () => {
              const chain = parseCluster(name);
              const url = rpcOn(chain);
              if (url) await knowsBlock(url, signed, chain);
              return svmOn(chain, url).broadcastTransaction!(signed, name);
            }),
        }
      : undefined,
  };
  const open = (
    as:
      | { auth: AomiAuthStrategy | AomiWalletStrategy }
      | { guest: ReturnType<typeof persistedGuest> },
  ) => {
    const aomi = new Aomi({
      baseUrl,
      apiKey: flags.apiKey ?? process.env.AOMI_API_KEY,
      ...(signer.evm || signer.svm ? { signer } : {}),
      ...as,
    });
    sending.set(aomi, { baseUrl, rpc });
    return aomi;
  };
  if (key)
    return open({
      auth: wallet(privateKeyToAccount(key), {
        chainId: flags.chain ?? state.chain,
      }),
    });
  if (solanaKey && signer.svm) return open({ auth: wallet(signer.svm) });
  if (await signedIn(baseUrl))
    return open({ auth: await deviceAuth(baseUrl, onCode) });
  return open({ guest: persistedGuest(baseUrl, state) });
}

/** A connection's backend, and the RPC `rpcReady` passed per chain
 * (undefined is the public one): the only one it sends on. */
type Sending = { baseUrl: string; rpc: Map<string, string | undefined> };
const sending = new WeakMap<Aomi, Sending>();

/** Where public RPCs reach the chains the commits are on; elsewhere (a local
 * stack) they reach the real chain, which a signed copy would then be sent to. */
const PRODUCTION = new Set(["https://aomi.chat/", "https://api.aomi.dev/"]);

const chainKey = (family: string, ref: string) =>
  family === "svm" ? parseCluster(ref) : `eip155:${ref}`;

async function rpcCall(url: string, method: string, params: unknown[]) {
  const answer = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
    .then((response) => response.json() as Promise<{ result?: unknown }>)
    // Its URL may hold a key, so no error names it.
    .catch(() => undefined);
  if (!answer?.result) throw new CliError("The RPC doesn't answer");
  return answer.result;
}

/** A Solana RPC is on the commit's chain, and no copy of it, when it knows
 * the block Aomi put in the transaction. */
async function knowsBlock(url: string, signed: string, chain: string) {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const { message } = VersionedTransaction.deserialize(
    Buffer.from(signed, "base64"),
  );
  const known = await rpcCall(url, "isBlockhashValid", [
    message.recentBlockhash,
    { commitment: "processed" },
  ]);
  if (!(known as { value?: boolean }).value)
    throw new CliError(
      `Not sent: the RPC doesn't know the block Aomi built this on, so it isn't Aomi's ${chain}`,
    );
}

/** A refused send, without the RPC's URL or the signed bytes. */
async function sent<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (error instanceof CliError) throw error;
    const { details, message } = error as {
      details?: unknown;
      message: string;
    };
    throw new CliError(
      `Not sent: ${plain(String(details ?? message))
        .replace(/\w+:\/\/\S+/gu, "the RPC")
        .replace(/[\w+/=]{80,}/gu, "…")}`,
    );
  }
}

/**
 * Before a local key signs what this machine then sends: the RPC that sends
 * it, asked for with `missing` when a Solana commit has none. Signed bytes it
 * cannot send would hold the nonce.
 */
export async function rpcReady(
  aomi: Aomi,
  flags: ConnectFlags,
  view: CommitRefView,
  missing: (chain: string) => Promise<string>,
): Promise<void> {
  if (view.broadcaster !== "wallet" || isMessageCommit(view)) return;
  const { baseUrl, rpc } = sending.get(aomi)!;
  const evm = view.chain_family === "evm";
  const chain = chainKey(view.chain_family, view.chain_ref);
  let url = flags.rpcUrl ?? loadState().rpc?.[baseUrl]?.[chain];
  if (!PRODUCTION.has(new URL(baseUrl).href)) {
    // A copy has its chain's id and its blocks, and no review names the block
    // it ran on: nothing tells the copy's RPC from the real chain's.
    if (evm)
      throw new CliError(
        `This Aomi is not production, so a key here sends nothing for ${chain}: use ${view.sign_url ?? "its sign page"}`,
        3,
      );
    url ??= await missing(chain);
  }
  if (url && evm) {
    const is = `eip155:${Number(await rpcCall(url, "eth_chainId", []))}`;
    if (is !== chain)
      throw new CliError(`The RPC is on ${is}, the commit on ${chain}`);
  }
  rpc.set(chain, url);
  if (url)
    updateState((state) => ({
      rpc: {
        ...state.rpc,
        [baseUrl]: { ...state.rpc?.[baseUrl], [chain]: url },
      },
    }));
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

export const out = (line = ""): void =>
  void process.stdout.write(`${plainText(line)}\n`);
export const err = (line = ""): void => void process.stderr.write(`${line}\n`);
export const json = (value: unknown, indent?: number): void =>
  void process.stdout.write(`${JSON.stringify(value, null, indent)}\n`);

/** One line: the error, the server's reason, and what to do. */
export function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return plainText(String(error));
  const { code, details, hint } = error as {
    code?: string;
    details?: { error?: { message?: string }; older_commit_ref?: string };
    hint?: string;
  };
  if (code === "commit_older_review_first")
    return plain(
      `An earlier review is still waiting. Sign or reject it first: aomi tx review ${details?.older_commit_ref ?? "<ref>"}`,
    );
  if (code === "commit_restage_needed")
    return "An earlier review was rejected, so this one is out of order. Ask again to prepare it fresh.";
  const reason = details?.error?.message;
  return plainText([error.message, reason, hint].filter(Boolean).join(": "));
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
