// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  Connection,
  Keypair,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { SafeSvmWalletState } from "./wallet-runtime";
import { buildSvmTransactionMethods } from "./transactions";

function wallet(
  overrides: Partial<SafeSvmWalletState> = {},
): SafeSvmWalletState {
  return {
    publicKey: "So11111111111111111111111111111111111111112",
    connected: true,
    connecting: false,
    disconnecting: false,
    walletName: "Test Wallet",
    wallets: [],
    select: undefined,
    connect: undefined,
    disconnect: undefined,
    signTransaction: undefined,
    signAllTransactions: undefined,
    signMessage: undefined,
    sendTransaction: vi.fn(),
    ...overrides,
  };
}

describe("buildSvmTransactionMethods", () => {
  it("omits direct sign-and-send when preferDirectSend is disabled", () => {
    const execution = buildSvmTransactionMethods(wallet(), {
      preferDirectSend: false,
      rpcHttpUrl: "https://solana.example",
    });

    expect(execution.signAndSendSolanaTransaction).toBeUndefined();
    expect(execution.sendSolanaTransaction).toBeTypeOf("function");
  });

  it("sends the exact approved transaction without refreshing its blockhash", async () => {
    const payer = Keypair.generate();
    const approvedBlockhash = Keypair.generate().publicKey.toBase58();
    const approved = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: approvedBlockhash,
        instructions: [],
      }).compileToV0Message(),
    );
    const sendTransaction = vi.fn<
      NonNullable<SafeSvmWalletState["sendTransaction"]>
    >(
      async (
        _tx: VersionedTransaction | Transaction,
        _connection: Connection,
      ) => "signature",
    );
    const execution = buildSvmTransactionMethods(wallet({ sendTransaction }), {
      preferDirectSend: false,
      rpcHttpUrl: "https://solana.example",
    });
    const confirmTransaction = vi
      .spyOn(Connection.prototype, "confirmTransaction")
      .mockResolvedValue({ context: { slot: 1 }, value: { err: null } });

    await execution.sendSolanaTransaction?.({
      unsignedTx: Buffer.from(approved.serialize()).toString("base64"),
    });

    const submitted = sendTransaction.mock.calls[0]?.[0];
    expect(submitted).toBeInstanceOf(VersionedTransaction);
    expect((submitted as VersionedTransaction).message.recentBlockhash).toBe(
      approvedBlockhash,
    );
    expect(confirmTransaction).toHaveBeenCalledWith("signature", "confirmed");
  });
});
