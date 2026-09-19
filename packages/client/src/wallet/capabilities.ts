import type { ActionResult } from "../agent/types";
import type { ActionCapabilities } from "../actions";
import type { ActionRequest } from "../agent/types";
import type {
  EvmWallet,
  SvmWallet,
  Wallets,
  WalletTransactionResult,
} from "./types";

export function walletCapabilities(wallets: Wallets): ActionCapabilities {
  return {
    ...(wallets.evm?.sendCalls || wallets.evm?.sendTransaction
      ? { execute_evm: executeEvm(wallets.evm) }
      : {}),
    ...(wallets.svm?.signAndSendTransaction || wallets.svm?.sendTransaction
      ? { execute_svm: executeSvm(wallets.svm) }
      : {}),
    ...(canSign(wallets) ? { sign: sign(wallets) } : {}),
  };
}

function executeEvm(wallet: EvmWallet) {
  return async (
    request: Extract<ActionRequest, { type: "execute_evm" }>,
    signal: AbortSignal,
  ): Promise<Extract<ActionResult, { status: "submitted" }>> => {
    const { transactions } = request;
    const first = transactions[0];
    if (!first) throw new Error("EVM Action contains no transactions");
    if (
      transactions.some(
        (transaction) =>
          transaction.chain_id !== first.chain_id ||
          transaction.from.toLowerCase() !== wallet.address.toLowerCase(),
      )
    ) {
      throw new Error("The active EVM wallet does not match the Action");
    }
    if (chainId(wallet) !== first.chain_id) {
      if (!wallet.switchChain) {
        throw new Error(`EVM wallet cannot switch to chain ${first.chain_id}`);
      }
      await wallet.switchChain(first.chain_id);
    }
    assertActive(signal);

    const calls = transactions.map(({ to, data, value }) => ({
      to,
      data,
      value,
    }));
    const hashes: string[] = [];
    if (wallet.sendCalls) {
      hashes.push(
        ...transactionHashes(
          await wallet.sendCalls({ chainId: first.chain_id, calls }),
        ),
      );
    } else if (wallet.sendTransaction) {
      for (const call of calls) {
        assertActive(signal);
        hashes.push(
          ...transactionHashes(
            await wallet.sendTransaction({ chainId: first.chain_id, ...call }),
          ),
        );
      }
    }
    if (hashes.length === 0) {
      throw new Error("EVM wallet returned no transaction hash");
    }
    return {
      status: "submitted",
      legs: transactions.map((_, index) => ({
        id: `leg_${index + 1}`,
        status: "submitted",
        transactionId: hashes[index] ?? hashes[hashes.length - 1],
      })),
    };
  };
}

function executeSvm(wallet: SvmWallet) {
  return async (
    request: Extract<ActionRequest, { type: "execute_svm" }>,
    signal: AbortSignal,
  ): Promise<Extract<ActionResult, { status: "submitted" }>> => {
    const { transactions } = request;
    const first = transactions[0];
    if (!first) throw new Error("SVM Action contains no transactions");
    if (
      transactions.some(
        (transaction) =>
          transaction.cluster !== first.cluster ||
          transaction.payer !== wallet.address,
      )
    ) {
      throw new Error("The active SVM wallet does not match the Action");
    }
    await switchCluster(wallet, first.cluster);

    const legs: Extract<ActionResult, { status: "submitted" }>["legs"] = [];
    for (const [index, transaction] of transactions.entries()) {
      assertActive(signal);
      const transactionBase64 = transaction.unsigned_transaction_base64;
      if (!transactionBase64) {
        throw new Error("SVM Action has no unsigned transaction bytes");
      }
      const result = wallet.signAndSendTransaction
        ? await wallet.signAndSendTransaction({
            transactionBase64,
            cluster: transaction.cluster,
          })
        : wallet.sendTransaction
          ? await wallet.sendTransaction({
              transactionBase64,
              cluster: transaction.cluster,
            })
          : undefined;
      if (result === undefined)
        throw new Error("SVM wallet cannot send transactions");
      legs.push({
        id: `leg_${index + 1}`,
        status: "submitted",
        transactionId: transactionHashes(result)[0] ?? signature(result),
        ...(typeof result === "object" && "signedTransaction" in result
          ? { signedTransactionBase64: result.signedTransaction }
          : {}),
      });
    }
    return { status: "submitted", legs };
  };
}

function sign(wallets: Wallets) {
  return async (
    request: Extract<ActionRequest, { type: "sign" }>,
    signal: AbortSignal,
  ): Promise<Extract<ActionResult, { status: "signed" }>> => {
    const outputs: Extract<ActionResult, { status: "signed" }>["outputs"] = [];
    if (request.chainFamily === "evm") {
      const wallet = wallets.evm;
      if (!wallet) throw new Error("No EVM wallet is configured");
      if (wallet.address.toLowerCase() !== request.signer.toLowerCase()) {
        throw new Error("The active EVM wallet is not the requested signer");
      }
      if (request.chainId && chainId(wallet) !== request.chainId) {
        if (!wallet.switchChain) {
          throw new Error(
            `EVM wallet cannot switch to chain ${request.chainId}`,
          );
        }
        await wallet.switchChain(request.chainId);
      }
      for (const [index, payload] of request.payloads.entries()) {
        assertActive(signal);
        if (payload.kind === "evm_personal") {
          if (!wallet.signMessage)
            throw new Error("EVM wallet cannot sign messages");
          outputs.push({
            id: `payload_${index + 1}`,
            signature: signature(
              await wallet.signMessage({
                message: payload.message,
                chainId: request.chainId,
              }),
            ),
          });
        } else if (payload.kind === "evm_typed_data") {
          if (!wallet.signTypedData) {
            throw new Error("EVM wallet cannot sign typed data");
          }
          outputs.push({
            id: `payload_${index + 1}`,
            signature: signature(
              await wallet.signTypedData({
                typedData: payload.typed_data,
                chainId: request.chainId,
              }),
            ),
          });
        } else {
          throw new Error("EVM signing Action contains an SVM payload");
        }
      }
    } else {
      const wallet = wallets.svm;
      if (!wallet) throw new Error("No SVM wallet is configured");
      if (wallet.address !== request.signer) {
        throw new Error("The active SVM wallet is not the requested signer");
      }
      await switchCluster(wallet, request.cluster);
      for (const [index, payload] of request.payloads.entries()) {
        assertActive(signal);
        if (payload.kind === "svm_message") {
          if (!wallet.signMessage)
            throw new Error("SVM wallet cannot sign messages");
          outputs.push({
            id: `payload_${index + 1}`,
            signature: signature(
              await wallet.signMessage({
                messageBase64: payload.message_base64,
                cluster: request.cluster,
              }),
            ),
          });
        } else if (payload.kind === "svm_transaction") {
          if (!wallet.signTransaction) {
            throw new Error("SVM wallet cannot sign transactions");
          }
          const result = await wallet.signTransaction({
            transactionBase64: payload.transaction_base64,
            cluster: request.cluster,
          });
          outputs.push(
            request.operationId
              ? { id: `payload_${index + 1}`, signature: signature(result) }
              : {
                  id: `payload_${index + 1}`,
                  signedTransactionBase64: signedTransaction(result),
                },
          );
        } else {
          throw new Error("SVM signing Action contains an EVM payload");
        }
      }
    }
    return { status: "signed", outputs };
  };
}

function canSign({ evm, svm }: Wallets): boolean {
  return Boolean(
    evm?.signMessage ||
    evm?.signTypedData ||
    svm?.signMessage ||
    svm?.signTransaction,
  );
}

function chainId(wallet: EvmWallet): number | undefined {
  return typeof wallet.chainId === "function"
    ? wallet.chainId()
    : wallet.chainId;
}

function cluster(wallet: SvmWallet): string | undefined {
  return typeof wallet.cluster === "function"
    ? wallet.cluster()
    : wallet.cluster;
}

async function switchCluster(wallet: SvmWallet, next?: string): Promise<void> {
  if (!next || next === cluster(wallet)) return;
  if (!wallet.switchCluster)
    throw new Error(`SVM wallet cannot switch to ${next}`);
  await wallet.switchCluster(next);
}

function transactionHashes(result: WalletTransactionResult): string[] {
  if (typeof result === "string") return [result];
  if (Array.isArray(result.hashes)) return result.hashes.filter(isString);
  if (Array.isArray(result.transactionHashes)) {
    return result.transactionHashes.filter(isString);
  }
  const hash = result.hash ?? result.transactionHash;
  return hash ? [hash] : [];
}

function signature(result: WalletTransactionResult): string {
  if (typeof result === "string") return result;
  if (result.signature) return result.signature;
  throw new Error("Wallet returned no signature");
}

function signedTransaction(result: WalletTransactionResult): string {
  if (typeof result === "string") return result;
  if (result.signedTransaction) return result.signedTransaction;
  throw new Error("Wallet returned no signed transaction");
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Action execution was aborted");
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}
