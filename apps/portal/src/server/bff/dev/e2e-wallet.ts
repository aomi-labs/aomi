import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletSolanaSignPayload } from "@aomi-labs/client";
import type { WalletTxPayload } from "@aomi-labs/react";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const E2E_WALLET_COOKIE = "aomi_e2e_wallet";

export type E2EWalletSeed = {
  address?: `0x${string}`;
  chainId?: number;
  svmAddress?: string;
  svmCluster?: E2ESvmCluster;
  expiresAt: number;
};

/**
 * `solana:mainnet` here means the LOCAL mainnet-fork mirror, never the real
 * cluster: `loopbackSolanaRpcUrl()` refuses any non-loopback RPC regardless of
 * cluster, so a mainnet-labeled seed can only ever sign against 127.0.0.1
 * (the Surfpool mirror `aomi test-env svm up --cluster mainnet-beta` runs).
 * Same posture as the EVM fork-verified executor policy, enforced harder.
 */
export type E2ESvmCluster =
  | "solana:devnet"
  | "solana:testnet"
  | "solana:mainnet";

const MAX_TTL_SECONDS = 60 * 60;
const DEFAULT_MAX_NATIVE_WEI = BigInt("1000000000000");

/**
 * Is this RPC an anvil fork? `anvil_nodeInfo` is anvil-only — a real RPC
 * returns a JSON-RPC error for it. Used to gate contract-call execution to
 * environments where money is not real. Fails closed on any error.
 */
async function isAnvilForkRpc(rpcUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_nodeInfo",
        params: [],
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    };
    return Boolean(body.result) && !body.error;
  } catch {
    return false;
  }
}
const LOCALHOST_CHAIN_ID = 31337;

type E2EExecuteErrorCode =
  | "disabled"
  | "unauthorized"
  | "invalid_request"
  | "policy_rejected"
  | "rpc_unavailable"
  | "execution_failed";

/** What actually mined before a sequential batch aborted mid-way.
 * Execution is sequential and non-atomic, so "the batch failed" without
 * this detail erases on-chain truth — the backend re-queues every leg and
 * the retry double-executes the ones that already landed. */
export type E2EPartialExecution = {
  /** Staged pending-tx ids that mined (in order). Empty when nothing did. */
  executedTxIds: number[];
  /** Hash of the last mined call, if any. */
  lastTxHash: `0x${string}` | null;
  /** The id of the call that failed, when the payload carried ids. */
  failedTxId: number | null;
  /** Ids never attempted because the batch aborts on first failure. */
  remainingTxIds: number[];
};

export type E2EExecuteResult =
  | {
      ok: true;
      txHash: `0x${string}`;
      chainId: number;
      from: `0x${string}`;
      to: `0x${string}`;
      valueWei: string;
      gasLimit: string;
      executionKind: "e2e_real_self_transfer" | "e2e_real_fork_call";
    }
  | {
      ok: false;
      error: string;
      code: E2EExecuteErrorCode;
      partial?: E2EPartialExecution;
    };

export type E2ESolanaResult =
  | { ok: true; signature: string; signedTx?: string }
  | { ok: false; error: string; code: E2EExecuteErrorCode };

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signingSecret(): string | null {
  const secret = process.env.AOMI_E2E_WALLET_TOKEN?.trim();
  return secret || null;
}

export function isE2EWalletEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL_ENV &&
    process.env.AOMI_ENABLE_E2E_WALLET === "true" &&
    signingSecret() !== null
  );
}

function executorPrivateKey(): Hex | null {
  const privateKey = process.env.AOMI_E2E_SIGNER_PRIVATE_KEY?.trim();
  if (!privateKey || !isHex(privateKey) || privateKey.length !== 66) {
    return null;
  }
  return privateKey;
}

export function isE2EExecutorEnabled(): boolean {
  return (
    isE2EWalletEnabled() &&
    process.env.AOMI_E2E_EXECUTION_MODE === "real" &&
    executorPrivateKey() !== null
  );
}

export function validateE2EWalletToken(token: string | null): boolean {
  const secret = signingSecret();
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseE2EAddress(value: string | null): `0x${string}` | null {
  const address = value?.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return address as `0x${string}`;
}

export function parseE2EChainId(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function parseE2ESvmAddress(value: string | null): string | null {
  const address = value?.trim();
  if (!address) return null;
  try {
    return new PublicKey(address).toBase58() === address ? address : null;
  } catch {
    return null;
  }
}

export function parseE2ESvmCluster(value: string | null): E2ESvmCluster {
  if (value === "solana:testnet") return "solana:testnet";
  if (value === "solana:mainnet") return "solana:mainnet";
  return "solana:devnet";
}

function normalizeE2ESvmCluster(
  value: string | undefined,
): E2ESvmCluster | null {
  if (value === "devnet" || value === "solana:devnet") return "solana:devnet";
  if (value === "testnet" || value === "solana:testnet")
    return "solana:testnet";
  if (
    value === "mainnet" ||
    value === "mainnet-beta" ||
    value === "solana:mainnet"
  )
    return "solana:mainnet";
  return null;
}

export function parseE2ETtlSeconds(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return 15 * 60;
  return Math.min(parsed, MAX_TTL_SECONDS);
}

function signPayload(payload: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintE2EWalletCookie(seed: {
  address?: `0x${string}`;
  chainId?: number;
  svmAddress?: string;
  svmCluster?: E2ESvmCluster;
  ttlSeconds: number;
}): string | null {
  if (!seed.address && !seed.svmAddress) return null;
  const payload = base64UrlEncode(
    JSON.stringify({
      address: seed.address,
      chainId: seed.chainId,
      svmAddress: seed.svmAddress,
      svmCluster: seed.svmAddress ? seed.svmCluster : undefined,
      expiresAt: Math.floor(Date.now() / 1000) + seed.ttlSeconds,
    } satisfies E2EWalletSeed),
  );
  const signature = signPayload(payload);
  return signature ? `${payload}.${signature}` : null;
}

export function verifyE2EWalletCookie(
  cookieValue: string | undefined,
): E2EWalletSeed | null {
  if (!isE2EWalletEnabled() || !cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload);
  if (!expectedSignature) return null;
  const expected = Buffer.from(expectedSignature);
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as E2EWalletSeed;
    const hasEvm = Boolean(
      parsed.address &&
      parseE2EAddress(parsed.address) &&
      Number.isInteger(parsed.chainId) &&
      (parsed.chainId ?? 0) > 0,
    );
    const hasSvm = Boolean(
      parsed.svmAddress &&
      parseE2ESvmAddress(parsed.svmAddress) &&
      (parsed.svmCluster === "solana:devnet" ||
        parsed.svmCluster === "solana:testnet" ||
        parsed.svmCluster === "solana:mainnet"),
    );
    if (!hasEvm && !hasSvm) return null;
    if (
      !Number.isInteger(parsed.expiresAt) ||
      parsed.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve the account an E2E session acts as, from `E2E_STUB_CANONICAL_USER_ID`.
 *
 * This does not create or impersonate a "test account" — it makes the session
 * authenticate AS the named real user, so threads, usage and billing land on
 * that account exactly as if they had signed in. Only the *signing key* is
 * disposable; the identity is genuine.
 *
 * Doubly gated: the env var alone does nothing without a valid signed E2E
 * cookie, and `isE2EWalletEnabled()` additionally requires a non-production
 * build with `VERCEL_ENV` unset. It cannot be pointed at a deployment.
 */
export function resolveE2ECanonicalUserId(request: Request): string | null {
  const userId = process.env.E2E_STUB_CANONICAL_USER_ID?.trim();
  if (!userId || !isE2EWalletEnabled()) return null;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${E2E_WALLET_COOKIE}=`));
  const value = cookie?.slice(E2E_WALLET_COOKIE.length + 1);
  return verifyE2EWalletCookie(value) ? userId : null;
}

function parseWei(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return BigInt(0);
  try {
    const parsed = BigInt(trimmed);
    return parsed >= BigInt(0) ? parsed : null;
  } catch {
    return null;
  }
}

function maxNativeWei(): bigint {
  return (
    parseWei(process.env.AOMI_E2E_MAX_NATIVE_WEI) ?? DEFAULT_MAX_NATIVE_WEI
  );
}

function rpcUrlForChain(chainId: number): string | null {
  const envName = `AOMI_E2E_RPC_URL_${chainId}`;
  const envRpc = process.env[envName]?.trim();
  if (envRpc) return envRpc;
  return chainId === LOCALHOST_CHAIN_ID ? "http://127.0.0.1:8545" : null;
}

function normalizeData(data: unknown): Hex {
  if (typeof data !== "string" || !data.trim()) return "0x";
  return data as Hex;
}

type E2ECall = {
  to: Address;
  value: bigint;
  data: Hex;
  chainId: number;
  callCount: number;
  /** Staged pending-tx id, when the payload carries one. Powers the
   * partial-outcome report: without ids the caller cannot tell the
   * backend WHICH legs of an aborted batch actually mined. */
  txId: number | null;
};

/** One raw call from a payload, normalized. `payload` supplies the fallback chain. */
function parseCall(
  rawCall: {
    to?: unknown;
    value?: unknown;
    data?: unknown;
    chainId?: unknown;
    txId?: unknown;
  },
  payload: WalletTxPayload,
  callCount: number,
): E2ECall | null {
  const to = typeof rawCall.to === "string" ? rawCall.to.trim() : "";
  if (!isAddress(to)) return null;
  const value = parseWei(rawCall.value ?? "0");
  if (value === null) return null;
  const data = normalizeData(rawCall.data);
  if (!isHex(data)) return null;
  const chainId =
    typeof rawCall.chainId === "number" && Number.isInteger(rawCall.chainId)
      ? rawCall.chainId
      : typeof payload.chainId === "number" && Number.isInteger(payload.chainId)
        ? payload.chainId
        : 0;
  if (chainId <= 0) return null;
  const txId =
    typeof rawCall.txId === "number" && Number.isInteger(rawCall.txId)
      ? rawCall.txId
      : null;

  return { to: getAddress(to), value, data, chainId, callCount, txId };
}

/**
 * Every call in the payload, in order.
 *
 * The original single-call reader silently blocked every batched flow —
 * approve+supply, or stake→wrap→approve→supply→borrow — rejecting with
 * "Unsupported E2E transaction payload" *after* the agent had already staged
 * and simulated the batch. Batches are the interesting case for a demo, so we
 * unpack them and let the caller decide whether the environment is safe enough
 * to run one (it is not, off a fork).
 */
function callsFromPayload(payload: WalletTxPayload): E2ECall[] | null {
  const calls = Array.isArray(payload.calls) ? payload.calls : [];
  const raw = calls.length > 0 ? calls : [payload];
  const parsed: E2ECall[] = [];
  for (const rawCall of raw) {
    const one = parseCall(rawCall, payload, raw.length);
    if (!one) return null;
    parsed.push(one);
  }
  return parsed.length > 0 ? parsed : null;
}

function e2eChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: `Aomi E2E ${chainId}`,
    nativeCurrency: {
      decimals: 18,
      name: "Ether",
      symbol: "ETH",
    },
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    },
  });
}

function reject(
  code: E2EExecuteErrorCode,
  error: string,
): { ok: false; code: E2EExecuteErrorCode; error: string } {
  return { ok: false, code, error };
}

export async function executeE2EvmTransaction({
  seed,
  payload,
}: {
  seed: E2EWalletSeed;
  payload: WalletTxPayload;
}): Promise<E2EExecuteResult> {
  if (!isE2EExecutorEnabled()) {
    return reject("disabled", "E2E real execution is disabled");
  }

  if (!seed.address || !seed.chainId) {
    return reject("unauthorized", "Seeded E2E wallet has no EVM identity");
  }

  const privateKey = executorPrivateKey();
  if (!privateKey) {
    return reject("disabled", "E2E signer private key is unavailable");
  }

  const account = privateKeyToAccount(privateKey);
  const signerAddress = getAddress(account.address);
  if (signerAddress !== getAddress(seed.address)) {
    return reject("unauthorized", "Seeded E2E wallet does not match signer");
  }

  const calls = callsFromPayload(payload);
  if (!calls) {
    return reject("invalid_request", "Unsupported E2E transaction payload");
  }
  const call = calls[0]!;
  // One chain per batch — but NOT necessarily the seed's chain. The E2E
  // wallet is explicitly multi-chain (one AOMI_E2E_RPC_URL_<id> per served
  // chain), and pinning execution to the seed chain broke every
  // cross-chain scenario's far leg: the bridge round-trip's Base→mainnet
  // return deposit died here with "does not match seed" while the agent
  // told the camera the funds were on their way. Which chains are safe is
  // decided below by configuration + the anvil-fork probe, not by which
  // chain the wallet happened to be seeded on.
  if (calls.some((one) => one.chainId !== call.chainId)) {
    return reject("policy_rejected", "Batch spans multiple chains");
  }

  const rpcUrl = rpcUrlForChain(call.chainId);
  if (!rpcUrl) {
    return reject("rpc_unavailable", "No E2E RPC URL configured for chain");
  }

  // Contract calls are permitted ONLY against a proven anvil fork. The probe
  // is the gate itself: `anvil_nodeInfo` exists on anvil and nothing else, so
  // a real RPC — or a fork that silently died and got replaced by something
  // else on the same port — falls through to the strict self-transfer policy
  // below. This keeps the E2E executor's original safety posture for every
  // real-chain configuration while letting the demo studio stake/swap on forks.
  const forkVerified = await isAnvilForkRpc(rpcUrl);
  if (!forkVerified) {
    // Off a fork the executor keeps its original posture exactly: exactly one
    // call, self-transfer, no calldata, positive value. A batch here is a
    // hard no — sequential real-chain sends are the last thing this should do.
    if (calls.length !== 1) {
      return reject(
        "policy_rejected",
        "Batched execution requires a verified anvil fork",
      );
    }
    if (call.to !== signerAddress) {
      return reject("policy_rejected", "Only self-transfers are allowed");
    }
    if (call.data !== "0x") {
      return reject(
        "policy_rejected",
        "Calldata is not allowed for self-transfer",
      );
    }
    if (call.value <= BigInt(0)) {
      return reject("policy_rejected", "Self-transfer value must be positive");
    }
  }
  // The cap binds the WHOLE batch, not each leg — otherwise N calls just under
  // the limit would together move far more than the cap intends to allow.
  const totalValue = calls.reduce((sum, one) => sum + one.value, BigInt(0));
  if (calls.some((one) => one.value < BigInt(0))) {
    return reject("policy_rejected", "Transfer value must not be negative");
  }
  if (totalValue > maxNativeWei()) {
    return reject("policy_rejected", "Transfer exceeds E2E value cap");
  }

  try {
    const chain = e2eChain(call.chainId, rpcUrl);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    // Sequential, not atomic: each call is mined before the next is estimated,
    // because a batch like approve→supply only estimates correctly once the
    // approval is on chain. Any failure aborts the rest — and MUST report
    // which legs already mined: the first take that hit a mid-batch revert
    // (Aave borrow, custom error 0x5b263df7) reported blanket failure, the
    // backend re-queued all six legs, and the retry re-ran an
    // already-executed 5 ETH stake into an insufficient-funds spiral.
    let txHash: `0x${string}` | null = null;
    let gas = BigInt(0);
    const executedTxIds: number[] = [];
    for (const [index, one] of calls.entries()) {
      try {
        const gasForCall = await publicClient.estimateGas({
          account: signerAddress,
          to: one.to,
          value: one.value,
          data: one.data,
        });
        txHash = await walletClient.sendTransaction({
          account,
          chain,
          to: one.to,
          value: one.value,
          data: one.data,
          gas: gasForCall,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        gas += gasForCall;
        if (one.txId !== null) executedTxIds.push(one.txId);
      } catch (error) {
        return {
          ok: false,
          code: "execution_failed",
          error:
            error instanceof Error ? error.message : "E2E transaction failed",
          partial: {
            executedTxIds,
            lastTxHash: txHash,
            failedTxId: one.txId,
            remainingTxIds: calls
              .slice(index + 1)
              .map((c) => c.txId)
              .filter((id): id is number => id !== null),
          },
        };
      }
    }
    if (!txHash) {
      return reject("invalid_request", "No executable calls in payload");
    }

    const last = calls[calls.length - 1]!;
    return {
      ok: true,
      txHash,
      chainId: call.chainId,
      from: signerAddress as `0x${string}`,
      to: last.to as `0x${string}`,
      valueWei: totalValue.toString(),
      gasLimit: gas.toString(),
      executionKind: forkVerified
        ? "e2e_real_fork_call"
        : "e2e_real_self_transfer",
    };
  } catch (error) {
    return reject(
      "execution_failed",
      error instanceof Error ? error.message : "E2E transaction failed",
    );
  }
}

function solanaSigner(): Keypair | null {
  try {
    const path = process.env.AOMI_E2E_SOLANA_KEYPAIR_PATH?.trim();
    const value = path
      ? readFileSync(path, "utf8")
      : process.env.AOMI_E2E_SOLANA_SIGNER_PRIVATE_KEY?.trim();
    if (!value) return null;
    const bytes = value.trim().startsWith("[")
      ? Uint8Array.from(JSON.parse(value) as number[])
      : bs58.decode(value.trim());
    return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : null;
  } catch {
    return null;
  }
}

function loopbackSolanaRpcUrl(): string | null {
  const value =
    process.env.AOMI_E2E_SOLANA_RPC_URL?.trim() ?? "http://127.0.0.1:8899";
  try {
    const url = new URL(value);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function isE2ESolanaExecutorEnabled(): boolean {
  return (
    isE2EWalletEnabled() &&
    process.env.AOMI_E2E_EXECUTION_MODE === "real" &&
    solanaSigner() !== null &&
    loopbackSolanaRpcUrl() !== null
  );
}

function authorizedSolanaSigner(seed: E2EWalletSeed): Keypair | null {
  const signer = solanaSigner();
  if (
    !signer ||
    !seed.svmAddress ||
    seed.svmCluster === undefined ||
    signer.publicKey.toBase58() !== seed.svmAddress
  ) {
    return null;
  }
  return signer;
}

export async function signE2ESolanaMessage({
  seed,
  message,
}: {
  seed: E2EWalletSeed;
  message: string;
}): Promise<E2ESolanaResult> {
  if (!isE2ESolanaExecutorEnabled()) {
    return reject("disabled", "E2E Solana execution is disabled");
  }
  const signer = authorizedSolanaSigner(seed);
  if (!signer) {
    return reject("unauthorized", "Seeded Solana wallet does not match signer");
  }
  try {
    const bytes = Buffer.from(message, "base64");
    return {
      ok: true,
      signature: Buffer.from(
        nacl.sign.detached(bytes, signer.secretKey),
      ).toString("base64"),
    };
  } catch {
    return reject("invalid_request", "Invalid Solana message payload");
  }
}

export async function executeE2ESolanaTransaction({
  seed,
  payload,
  broadcast,
}: {
  seed: E2EWalletSeed;
  payload: WalletSolanaSignPayload;
  broadcast: boolean;
}): Promise<E2ESolanaResult> {
  if (!isE2ESolanaExecutorEnabled()) {
    return reject("disabled", "E2E Solana execution is disabled");
  }
  const signer = authorizedSolanaSigner(seed);
  if (!signer) {
    return reject("unauthorized", "Seeded Solana wallet does not match signer");
  }
  if (
    !payload.unsignedTx ||
    normalizeE2ESvmCluster(payload.cluster) !== seed.svmCluster
  ) {
    return reject("policy_rejected", "Solana request does not match seed");
  }
  const rpcUrl = loopbackSolanaRpcUrl();
  if (!rpcUrl) {
    return reject("rpc_unavailable", "Solana E2E RPC must be loopback");
  }

  try {
    const raw = Buffer.from(payload.unsignedTx, "base64");
    let serialized: Uint8Array;
    try {
      const transaction = VersionedTransaction.deserialize(raw);
      if (
        transaction.message.staticAccountKeys[0]?.toBase58() !== seed.svmAddress
      ) {
        return reject(
          "policy_rejected",
          "Solana fee payer does not match seed",
        );
      }
      transaction.sign([signer]);
      serialized = transaction.serialize();
    } catch {
      const transaction = Transaction.from(raw);
      if (transaction.feePayer?.toBase58() !== seed.svmAddress) {
        return reject(
          "policy_rejected",
          "Solana fee payer does not match seed",
        );
      }
      transaction.partialSign(signer);
      serialized = transaction.serialize();
    }

    const signedTx = Buffer.from(serialized).toString("base64");
    if (!broadcast) return { ok: true, signature: "", signedTx };

    const connection = new Connection(rpcUrl, "confirmed");
    const signature = await connection.sendRawTransaction(serialized);
    const confirmation = await connection.confirmTransaction(
      signature,
      "confirmed",
    );
    if (confirmation.value.err) {
      return reject("execution_failed", "Solana transaction was not confirmed");
    }
    return { ok: true, signature, signedTx };
  } catch (error) {
    return reject(
      "execution_failed",
      error instanceof Error ? error.message : "Solana transaction failed",
    );
  }
}
