import {
  PublicKey,
  VersionedTransaction,
  type Connection as SolanaConnection,
  type Transaction as SolanaTransaction,
} from "@solana/web3.js";
import {
  decodeBase64,
  encodeBase64,
} from "@/wallet/runtime/svm/transactions";
import type { SafeSvmWalletState } from "@/wallet/runtime/svm/wallet-runtime";
import {
  signParaSolanaMessage,
  type ParaSigningClient,
} from "./para-message-signing";

type SolanaTx = VersionedTransaction | SolanaTransaction;

/** The accounts that must sign `tx`, in the order the message lists them. */
function requiredSigners(tx: SolanaTx): PublicKey[] {
  const message =
    tx instanceof VersionedTransaction ? tx.message : tx.compileMessage();
  return message.staticAccountKeys.slice(
    0,
    message.header.numRequiredSignatures,
  );
}

/**
 * Sign `tx` as the Para embedded Solana wallet at `address`. A Solana
 * signature is Ed25519 over the transaction's message bytes, which is what
 * Para's `signMessage` signs. Signatures already on `tx` are kept.
 */
export async function signParaSolanaTransaction<T extends SolanaTx>(
  paraSession: ParaSigningClient,
  address: string,
  tx: T,
): Promise<T> {
  const signer = new PublicKey(address);
  if (!requiredSigners(tx).some((key) => key.equals(signer)))
    throw new Error(
      "This transaction is for another wallet than your Para Solana wallet. Nothing was signed.",
    );
  const message =
    tx instanceof VersionedTransaction
      ? tx.message.serialize()
      : tx.serializeMessage();
  const { signature } = await signParaSolanaMessage(
    paraSession,
    address,
    encodeBase64(message),
  );
  // web3.js copies these bytes; only its legacy type asks for a Buffer.
  tx.addSignature(signer, decodeBase64(signature) as Buffer);
  return tx;
}

/**
 * The Para embedded Solana wallet in the shape the Solana runtime signs and
 * sends through. Para is not a wallet-adapter wallet, so without this a
 * transaction falls to the adapter, which has no wallet selected.
 */
export function paraSvmWallet(
  paraSession: ParaSigningClient,
  address: string,
): SafeSvmWalletState {
  const sign = <T extends SolanaTx>(tx: T) =>
    signParaSolanaTransaction(paraSession, address, tx);
  return {
    publicKey: address,
    connected: true,
    connecting: false,
    disconnecting: false,
    walletName: "Para",
    transport: "embedded",
    wallets: [],
    select: undefined,
    connect: undefined,
    disconnect: undefined,
    signMessage: undefined,
    signTransaction: sign,
    signAllTransactions: async (txs) => {
      const signed: SolanaTx[] = [];
      for (const tx of txs) signed.push(await sign(tx));
      return signed;
    },
    sendTransaction: async (tx: SolanaTx, connection: SolanaConnection) =>
      // serialize() refuses a transaction another signer has not signed yet.
      connection.sendRawTransaction((await sign(tx)).serialize()),
  };
}
