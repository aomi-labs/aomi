"use client";

import type { EvmWallet } from "@aomi-labs/client";
import type { UnsignedTransactionRequest } from "@privy-io/react-auth";
import { isHex, type Hex } from "viem";

/**
 * The slice of Privy's `ConnectedWallet` the embedded EOA execution path uses.
 * Narrow on purpose: the tests build one from a couple of stubs.
 */
export type PrivyEmbeddedEvmWallet = {
  address: string;
  /** CAIP-2, e.g. `eip155:8453`. */
  chainId?: string;
  switchChain: (chainId: `0x${string}` | number) => Promise<void>;
  getEthereumProvider: () => Promise<{
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  }>;
};

export type PrivySignTransaction = (
  transaction: UnsignedTransactionRequest,
  options?: { address?: string },
) => Promise<{ signature: unknown }>;

/** `eip155:8453` -> `8453`. Undefined for anything that isn't an EVM CAIP-2. */
export function parseCaip2EvmChainId(
  caip2: string | undefined,
): number | undefined {
  if (!caip2) return undefined;
  const [namespace, reference] = caip2.split(":");
  if (namespace !== "eip155") return undefined;
  const chainId = Number(reference);
  return Number.isInteger(chainId) && chainId > 0 ? chainId : undefined;
}

function toQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

/**
 * Put the embedded wallet on `chainId` if it isn't already.
 *
 * Privy pins a provider to the chain it was built on and does not migrate
 * existing instances, so callers must re-request `getEthereumProvider()`
 * afterwards — `sendPrivyEmbeddedTransaction` does exactly that.
 */
export async function switchPrivyEmbeddedChain(
  wallet: PrivyEmbeddedEvmWallet,
  chainId: number,
): Promise<void> {
  if (parseCaip2EvmChainId(wallet.chainId) === chainId) return;
  await wallet.switchChain(chainId);
}

/**
 * Broadcast one call from Privy's embedded EOA.
 *
 * This is the path the portal takes for every Privy user without a client
 * smart account. Without it the kit had no EVM send for the embedded wallet
 * at all: the request fell through to a wagmi connector that was never
 * connected, threw, and was rejected before any Privy prompt could appear.
 */
export async function sendPrivyEmbeddedTransaction({
  wallet,
  owner,
  chainId,
  to,
  value,
  data,
}: {
  wallet: PrivyEmbeddedEvmWallet;
  owner: string;
  chainId: number;
  to: Hex;
  value: bigint;
  data?: Hex;
}): Promise<string> {
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("The active Privy EOA is not the requested sender");
  }
  await switchPrivyEmbeddedChain(wallet, chainId);
  const provider = await wallet.getEthereumProvider();
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: owner,
        to,
        value: toQuantity(value),
        ...(data ? { data } : {}),
      },
    ],
  });
  if (typeof hash !== "string") {
    throw new Error("Privy returned an invalid transaction hash");
  }
  return hash;
}

/**
 * Sign, without broadcasting, one commit transaction from Privy's embedded EOA.
 *
 * The commit lifecycle submits the signed bytes itself, so this must not fall
 * back to `eth_sendTransaction`. The embedded wallet has no wagmi connector,
 * which is why the shared wallet-client signer cannot serve it. Every field is
 * sent through Privy's supported sign-only hook exactly as the Commit Service
 * quoted it, with no repopulation of nonce, gas or fees.
 */
export async function signPrivyEmbeddedTransaction({
  walletAddress,
  signTransaction,
  payload,
}: {
  walletAddress: string;
  signTransaction: PrivySignTransaction;
  payload: Parameters<NonNullable<EvmWallet["signTransaction"]>>[0];
}): Promise<string> {
  if (payload.signer.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error("The active Privy EOA is not the requested signer");
  }
  const tx = payload.transaction;
  const { signature } = await signTransaction(
    {
      from: walletAddress,
      to: tx.to,
      value: BigInt(tx.value),
      data: tx.data,
      chainId: payload.chain_id,
      type: 2,
      nonce: payload.nonce,
      gasLimit: BigInt(tx.gas_limit),
      maxFeePerGas: BigInt(tx.max_fee_per_gas),
      maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
    },
    { address: walletAddress },
  );
  if (
    typeof signature !== "string" ||
    signature.length <= 2 ||
    !isHex(signature)
  ) {
    throw new Error("Privy returned an invalid signed transaction");
  }
  return signature;
}
