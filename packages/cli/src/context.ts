import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  Aomi,
  AomiError,
  CLIENT_TYPE_TS_CLI,
  createGuestSessionProvider,
  oauth,
  UserState,
  wallet,
  type AomiAuthStrategy,
  type AgentTarget,
} from "@aomi-labs/client";
import { viemSigner } from "@aomi-labs/client/viem";
import { createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";
import { grants, loadState, updateState, type CliState } from "./state";

export const DEFAULT_BASE_URL = "https://chat.aomi.dev";

/** Exit codes: 0 ok, 1 error, 2 usage, 3 needs approval or sign-in. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export const usage = (message: string) => new CliError(message, 2);

/** What every command that talks to Aomi accepts. */
export type ConnectFlags = {
  backendUrl?: string;
  apiKey?: string;
  privateKey?: string;
  solanaPrivateKey?: string;
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
  "account:apps:read",
  "account:apps:write",
  "account:credentials:read",
  "account:credentials:write",
  "account:transaction-safety:read",
  "account:transaction-safety:write",
  "account:credits:read",
  "account:credits:fund",
  "account:usage:read",
  "offline_access",
];

/**
 * The grant `aomi login` holds, for the one `/v1` resource. A 0.2 install kept
 * per-resource grants whose OAuth clients are bound to those resources, so
 * they can neither sign in again nor count as signed in.
 */
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
  const held = await heldGrant(baseUrl);
  return oauth({
    clientId: held?.clientId,
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

/** `--private-key` (or AOMI_PRIVATE_KEY): signs in headlessly and signs. */
export function privateKeyOf(flags: ConnectFlags): `0x${string}` | undefined {
  const key = (flags.privateKey ?? process.env.AOMI_PRIVATE_KEY)?.trim();
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    throw usage("--private-key must be a 0x-prefixed 32-byte hex key");
  return key as `0x${string}`;
}

/**
 * One `Aomi` for the command: signed in with `--private-key`, else with
 * the device grant from `aomi login`, else as a guest. The signer is the
 * key from the flags or `aomi wallets signer set`.
 */
export async function connect(
  flags: ConnectFlags = {},
  onCode?: ShowCode,
): Promise<Aomi> {
  const state = loadState();
  const baseUrl = baseUrlOf(flags, state);
  const key = privateKeyOf(flags);
  const evmKey = key ?? (state.evmKey as `0x${string}` | undefined);
  const svmKey =
    flags.solanaPrivateKey ??
    process.env.AOMI_SOLANA_PRIVATE_KEY ??
    state.svmKey;
  const signer = {
    evm: evmKey
      ? viemSigner(
          createWalletClient({
            account: privateKeyToAccount(evmKey),
            chain: chainOf(flags.chain ?? state.chain ?? 1),
            transport: http(flags.rpcUrl),
          }),
        )
      : undefined,
    // Loaded only when used: @solana/web3.js is heavy and warns on import.
    svm: svmKey
      ? (await import("@aomi-labs/client/solana")).solanaSigner(svmKey)
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
  if (await signedIn(baseUrl))
    return new Aomi({ ...common, auth: await deviceAuth(baseUrl, onCode) });
  return new Aomi({ ...common, guest: persistedGuest(baseUrl, state) });
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

/** What a turn runs with: the thread, `--app` (else Auto), model and wallet. */
export function turnOptions(
  aomi: Aomi,
  state: CliState,
  overrides: {
    thread?: string;
    app?: string;
    model?: string;
    chain?: number;
    /** A new thread's wallet per family (`/wallet` before the first turn). */
    walletPick?: { evm?: string; svm?: string };
  } = {},
) {
  const app = overrides.app;
  const target: AgentTarget = app ? { mode: "direct", app } : { mode: "auto" };
  const evm = aomi.wallet?.evm?.address;
  const svm = aomi.wallet?.svm?.address;
  const chainId = overrides.chain ?? state.chain;
  const userState = UserState.withExt(
    {
      ...(evm
        ? { evm: { address: evm, ...(chainId ? { chain_id: chainId } : {}) } }
        : {}),
      ...(svm
        ? { svm: { address: svm, cluster: state.cluster ?? "solana:mainnet" } }
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

/** Who a thread belongs to: another sign-in can't continue it. */
export const ownerOf = (aomi: Aomi) =>
  aomi.auth.mode === "wallet"
    ? `wallet:${aomi.wallet?.evm?.address}`
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
