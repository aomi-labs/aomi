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
  /** Chains whose wallet refused `wallet_sendCalls`: one prompt per call there. */
  const noBundles = new Set<number>();
  // A viem client's `chain` is fixed at creation; track the wallet's own.
  let current = wallet.chain?.id;
  const onChain = async (chainId: number) => {
    // A local key signs for any chain; only its broadcasts need the RPC.
    if (!local && (current ?? (await wallet.getChainId())) !== chainId)
      await wallet.switchChain({ id: chainId });
    current = chainId;
  };
  const signer: EvmWallet = {
    address: account.address,
    chainId: () => current,
    switchChain: onChain,
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
        if (wallet.chain?.id !== chainId)
          throw new AomiError(
            "wrong_chain",
            `This wallet client sends on chain ${wallet.chain?.id}, the commit is on ${chainId}`,
          );
        return wallet.sendRawTransaction({
          serializedTransaction: signed as Hex,
        });
      },
    };
  return {
    ...signer,
    preparePreparedTransaction: async () => undefined,
    sendPreparedTransaction: async ({ chain_id, transaction: tx }, onPhase) => {
      if (current !== chain_id) onPhase?.("switching_chain");
      await onChain(chain_id);
      onPhase?.("awaiting_wallet");
      return wallet.sendTransaction({
        account,
        chain: null,
        to: getAddress(tx.to),
        data: tx.data as Hex,
        value: BigInt(tx.value),
      });
    },
    supportsAtomicBatch: (chainId) => !noBundles.has(chainId),
    sendPreparedCalls: async ({ chain_id, calls }, onPhase) => {
      if (current !== chain_id) onPhase?.("switching_chain");
      await onChain(chain_id);
      onPhase?.("awaiting_wallet");
      try {
        const { id } = await wallet.sendCalls({
          account,
          // Only the id is read: the wallet's chain, not the client's.
          chain: { ...wallet.chain, id: chain_id } as Chain,
          calls: calls.map((call) => ({
            to: getAddress(call.to),
            data: call.data as Hex,
            value: BigInt(call.value),
          })),
        });
        onPhase?.("submitting");
        const { receipts = [] } = await wallet.waitForCallsStatus({ id });
        return receipts.map((receipt) => receipt.transactionHash);
      } catch (error) {
        if (isUnsupported(error)) noBundles.add(chain_id);
        throw error;
      }
    },
  };
}

function signLocal(
  account: Account,
  transaction: Parameters<NonNullable<Account["signTransaction"]>>[0],
): Promise<Hex> {
  if (!account.signTransaction)
    throw new AomiError("no_signer", "This account cannot sign transactions");
  return account.signTransaction(transaction);
}

/** EIP-5792 not supported (4200) or the method missing (-32601). */
function isUnsupported(error: unknown): boolean {
  for (let cause = error; cause; cause = (cause as { cause?: unknown }).cause)
    if ([4200, -32601].includes((cause as { code?: number }).code ?? 0))
      return true;
  return false;
}
