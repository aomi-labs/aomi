// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
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
  it.each(["legacy", "v0"])(
    "passes every %s instruction unchanged to the signing wallet",
    async (version) => {
      const payer = Keypair.generate();
      const recipient = Keypair.generate().publicKey;
      const instructions = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient,
          lamports: 1_000_000,
        }),
      ];
      const message = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions,
      });
      const transaction = new VersionedTransaction(
        version === "v0"
          ? message.compileToV0Message()
          : message.compileToLegacyMessage(),
      );
      const unsignedTx = Buffer.from(transaction.serialize()).toString(
        "base64",
      );
      const signed = VersionedTransaction.deserialize(transaction.serialize());
      signed.sign([payer]);
      const signTransaction = vi.fn(
        async (received: VersionedTransaction | Transaction) => {
          expect(
            Buffer.from(
              received instanceof VersionedTransaction
                ? received.message.serialize()
                : received.serializeMessage(),
            ),
          ).toEqual(Buffer.from(transaction.message.serialize()));
          return signed;
        },
      );
      const execution = buildSvmTransactionMethods(
        wallet({ signTransaction }),
        {
          preferDirectSend: false,
          rpcHttpUrl: "https://solana.example",
        },
      );
      expect(await execution.signSolanaTransaction!({ unsignedTx })).toEqual({
        signedTx: Buffer.from(signed.serialize()).toString("base64"),
      });
      expect(Buffer.from(signed.serialize()).toString("base64")).not.toBe(
        unsignedTx,
      );
      expect(signTransaction).toHaveBeenCalledOnce();
    },
  );

  it("rejects an exact-signer mismatch before asking the connected wallet to sign", async () => {
    const signMessage = vi.fn();
    const execution = buildSvmTransactionMethods(wallet({ signMessage }), {
      preferDirectSend: false,
      rpcHttpUrl: "https://solana.example",
    });
    await expect(
      execution.signSolanaMessage!({
        signer: "AnotherWallet",
        message: "cGVybWl0",
      }),
    ).rejects.toThrow("not connected");
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("signs a batch in one signAllTransactions prompt, in order", async () => {
    const payer = Keypair.generate();
    const unsigned = [1, 2].map(() =>
      Buffer.from(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: Keypair.generate().publicKey.toBase58(),
            instructions: [],
          }).compileToV0Message(),
        ).serialize(),
      ).toString("base64"),
    );
    const signAllTransactions = vi.fn(
      async (txs: Array<VersionedTransaction | Transaction>) => txs,
    );
    const execution = buildSvmTransactionMethods(
      wallet({ signAllTransactions }),
      { preferDirectSend: false, rpcHttpUrl: "https://solana.example" },
    );

    const signed = await execution.signAllSolanaTransactions!(
      unsigned.map((unsignedTx) => ({ unsignedTx })),
    );

    expect(signAllTransactions).toHaveBeenCalledTimes(1);
    expect(signed.map(({ signedTx }) => signedTx)).toEqual(unsigned);
    expect(
      buildSvmTransactionMethods(wallet(), {
        preferDirectSend: false,
        rpcHttpUrl: "https://solana.example",
      }).signAllSolanaTransactions,
    ).toBeUndefined();
  });

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
