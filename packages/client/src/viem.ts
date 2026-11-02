import {
  getAddress,
  isHex,
  type Account,
  type Chain,
  type Hex,
  type WalletClient,
} from "viem";
import { AomiError } from "./api-error";
import type { EvmWallet } from "./wallet/types";
import { toViemSignMessageArgs, toViemSignTypedDataArgs } from "./wallet-utils";

/**
 * `signer.evm` from a viem wallet client. A local account (a private key)
 * signs here and Aomi broadcasts; a browser wallet sends itself, bundling a
 * batch with EIP-5792 `wallet_sendCalls` where the wallet supports it.
 */
export function viemSigner(wallet: WalletClient): EvmWallet {
  const account = wallet.account;
  if (!account)
    throw new AomiError(
      "no_account",
      "viemSigner needs a wallet client with an account",
    );
  const local = account.type === "local";
  /** Move the wallet to `chainId` and confirm it got there. A local key signs
   * for any chain, so it has nothing to move. */
  const onChain = async (chainId: number, onSwitch?: () => void) => {
    if (local || (await wallet.getChainId()) === chainId) return;
    onSwitch?.();
    await wallet.switchChain({ id: chainId });
    const now = await wallet.getChainId();
    if (now !== chainId)
      throw new AomiError(
        "wrong_chain",
        `The wallet stayed on chain ${now}; the commit is on ${chainId}`,
      );
  };
  /** Sends name their chain, so viem checks the wallet is still on it. */
  const target = (id: number) => ({ id }) as Chain;
  const signer: EvmWallet = {
    address: account.address,
    ...(local ? { chainId: () => wallet.chain?.id } : {}),
    switchChain: (chainId) => onChain(chainId),
    signMessage: async ({ message }) => {
      const args = toViemSignMessageArgs({ non_typed_data: message });
      if (!args) throw new AomiError("invalid_message", "Empty message");
      return wallet.signMessage({ account, ...args });
    },
    signTypedData: async ({ typedData }) => {
      const args = toViemSignTypedDataArgs({ typed_data: typedData });
      if (!args?.message)
        throw new AomiError("invalid_message", "Invalid typed data");
      const { message, ...request } = args;
      return wallet.signTypedData({ account, ...request, message });
    },
  };
  if (local)
    return {
      ...signer,
      signTransaction: async ({ chain_id, nonce, transaction: tx }) => {
        if (!isHex(tx.data))
          throw new AomiError("invalid_transaction", "Commit data is not hex");
        return signLocal(account, {
          chainId: chain_id,
          type: "eip1559",
          nonce,
          to: getAddress(tx.to),
          data: tx.data,
          value: BigInt(tx.value),
          gas: BigInt(tx.gas_limit),
          maxFeePerGas: BigInt(tx.max_fee_per_gas),
          maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
        });
      },
      broadcastTransaction: async (signed, chainId) => {
        const rpc = await wallet.getChainId();
        if (rpc !== chainId)
          throw new AomiError(
            "wrong_chain",
            `This wallet client sends on chain ${rpc}, the commit is on ${chainId}`,
          );
        return wallet.sendRawTransaction({
          serializedTransaction: signed as Hex,
        });
      },
    };
  // EIP-5792: bundle only on chains the wallet says can batch, learned
  // before any commit picks how to send.
  const atomic = new Set<number>();
  void wallet
    .getCapabilities({ account })
    .then((chains) => {
      for (const [id, capabilities] of Object.entries(chains))
        if (canBatch(capabilities)) atomic.add(Number(id));
    })
    .catch(() => undefined);
  return {
    ...signer,
    preparePreparedTransaction: async () => undefined,
    sendPreparedTransaction: async ({ chain_id, transaction: tx }, onPhase) => {
      await onChain(chain_id, () => onPhase?.("switching_chain"));
      onPhase?.("awaiting_wallet");
      return wallet.sendTransaction({
        account,
        chain: target(chain_id),
        to: getAddress(tx.to),
        data: tx.data as Hex,
        value: BigInt(tx.value),
      });
    },
    supportsAtomicBatch: (chainId) => atomic.has(chainId),
    sendPreparedCalls: async ({ chain_id, calls }, onPhase) => {
      await onChain(chain_id, () => onPhase?.("switching_chain"));
      onPhase?.("awaiting_wallet");
      let id: string;
      try {
        ({ id } = await wallet.sendCalls({
          account,
          chain: target(chain_id),
          calls: calls.map((call) => ({
            to: getAddress(call.to),
            data: call.data as Hex,
            value: BigInt(call.value),
          })),
        }));
      } catch (error) {
        if (isUnsupported(error)) atomic.delete(chain_id);
        throw error;
      }
      onPhase?.("submitting");
      const { status, receipts = [] } = await wallet.waitForCallsStatus({ id });
      if (status !== "success" || receipts.length === 0)
        throw new AomiError(
          "calls_failed",
          `The wallet reports the call bundle ${status ?? "unknown"}`,
        );
      return receipts.map((receipt) => receipt.transactionHash);
    },
  };
}

/** EIP-5792 v2 `atomic`, or the older `atomicBatch`. */
function canBatch(capabilities: Record<string, unknown>): boolean {
  const { atomic, atomicBatch } = capabilities as {
    atomic?: { status?: string };
    atomicBatch?: { supported?: boolean };
  };
  return (
    atomic?.status === "supported" ||
    atomic?.status === "ready" ||
    atomicBatch?.supported === true
  );
}

function signLocal(
  account: Account,
  transaction: Parameters<NonNullable<Account["signTransaction"]>>[0],
): Promise<Hex> {
  if (!account.signTransaction)
    throw new AomiError("no_signer", "This account cannot sign transactions");
  return account.signTransaction(transaction);
}

/** EIP-5792 not supported (4200), the method missing (-32601) or not
 * implemented (-32004). */
function isUnsupported(error: unknown): boolean {
  for (let cause = error; cause; cause = (cause as { cause?: unknown }).cause)
    if ([4200, -32601, -32004].includes((cause as { code?: number }).code ?? 0))
      return true;
  return false;
}
