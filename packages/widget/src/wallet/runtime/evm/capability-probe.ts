import type { WalletCapabilities } from "./wagmi-hooks";
import { walletDebug } from "@/wallet/wallet-debug";

/** EIP-1193 `request` of the connected wallet's own provider. */
export type CapabilityRequest = (args: {
  method: "wallet_getCapabilities";
  params: readonly unknown[];
}) => Promise<unknown>;

export type CapabilityMap = NonNullable<WalletCapabilities>;

/** A probe that answered: the wallet's per-chain capabilities, or no EIP-5792. */
export type CapabilityProbe = {
  capabilities: CapabilityMap;
  unsupported?: true;
};

/** What this session learned can't batch: a connector that answered -32601
 * (never probed again), or a connector + chain + account that refused a bundle. */
const noBatch = new Set<string>();
const batchKey = (connectorUid: string, chainId: number, account: string) =>
  `${connectorUid}:${chainId}:${account.toLowerCase()}`;
export const markNoEip5792 = (connectorUid: string) =>
  noBatch.add(connectorUid);
export const knownNoEip5792 = (connectorUid: string) =>
  noBatch.has(connectorUid);
export const markNoBatch = (
  connectorUid: string,
  chainId: number,
  account: string,
) => noBatch.add(batchKey(connectorUid, chainId, account));
export const knownNoBatch = (
  connectorUid: string,
  chainId: number,
  account: string,
) =>
  noBatch.has(connectorUid) ||
  noBatch.has(batchKey(connectorUid, chainId, account));

/** JSON-RPC -32601 / "method not found" / Rabby's "doesn't has corresponding handler". */
export function isMethodNotFound(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = error; e && typeof e === "object" && !seen.has(e); ) {
    seen.add(e);
    const { code, message, cause } = e as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === -32601) return true;
    if (
      typeof message === "string" &&
      /method not found|not supported|corresponding handler|does not exist/i.test(
        message,
      )
    )
      return true;
    e = cause;
  }
  return false;
}

/** `0x2105`, `8453` and `eip155:8453` all name Base. */
export function capabilityChainId(key: string): number | undefined {
  const raw = key.startsWith("eip155:") ? key.slice(7) : key;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Re-key a raw `wallet_getCapabilities` answer by decimal chain id. */
export function normalizeCapabilityKeys(raw: unknown): CapabilityMap {
  const out: CapabilityMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = capabilityChainId(key);
    if (id !== undefined && value && typeof value === "object")
      out[String(id)] = value as CapabilityMap[string];
  }
  return out;
}

/**
 * Ask the wallet for its capabilities. EIP-5792 v2 wallets (MetaMask) take
 * `[address, [chainIdHex, ...]]`; a wallet that rejects that form gets the
 * bare `[address]`. -32601 means the wallet has no EIP-5792 at all.
 */
export async function probeWalletCapabilities(args: {
  request: CapabilityRequest;
  address: string;
  chainIds: readonly number[];
}): Promise<CapabilityProbe> {
  const { request, address, chainIds } = args;
  const ask = (params: readonly unknown[]) =>
    request({ method: "wallet_getCapabilities", params });
  let raw: unknown;
  try {
    raw = await ask([address, chainIds.map((id) => `0x${id.toString(16)}`)]);
  } catch (error) {
    if (isMethodNotFound(error)) return { capabilities: {}, unsupported: true };
    walletDebug("aa:capabilities-2arg-rejected", { error: describe(error) });
    try {
      raw = await ask([address]);
    } catch (fallback) {
      if (isMethodNotFound(fallback))
        return { capabilities: {}, unsupported: true };
      throw fallback;
    }
  }
  return { capabilities: normalizeCapabilityKeys(raw) };
}

export const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
