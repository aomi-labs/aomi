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
import { buildSvmTransactionMethods, sendSolana } from "./transactions";

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

  describe("v1 transactions", () => {
    // A v1 transaction opens with its 0x81 version prefix; web3.js 1.x
    // cannot decode it, so these bytes only need the prefix to route.
    const v1Unsigned = Uint8Array.from([0x81, 1, 2, 3]);
    const v1Signed = Uint8Array.from([0x81, 9, 9, 9]);
    const v1Base64 = Buffer.from(v1Unsigned).toString("base64");

    it("signs v1 bytes through the raw signer, never through web3.js", async () => {
      const signTransaction = vi.fn();
      const signV1Transactions = vi.fn(async (txs: readonly Uint8Array[]) =>
        txs.map(() => v1Signed),
      );
      const execution = buildSvmTransactionMethods(
        wallet({ signTransaction, signV1Transactions }),
        { preferDirectSend: false, rpcHttpUrl: "https://solana.example" },
      );

      const { signedTx } = await execution.signSolanaTransaction!({
        unsignedTx: v1Base64,
      });

      expect(signV1Transactions).toHaveBeenCalledWith([v1Unsigned]);
      expect(signTransaction).not.toHaveBeenCalled();
      expect(signedTx).toBe(Buffer.from(v1Signed).toString("base64"));
    });

    it("refuses v1 bytes when the wallet did not list version 1", async () => {
      const signTransaction = vi.fn();
      const execution = buildSvmTransactionMethods(
        wallet({ signTransaction }),
        { preferDirectSend: false, rpcHttpUrl: "https://solana.example" },
      );

      await expect(
        execution.signSolanaTransaction!({ unsignedTx: v1Base64 }),
      ).rejects.toThrow("cannot sign v1");
      expect(signTransaction).not.toHaveBeenCalled();
    });

    it("signs a batch holding v1 in one raw prompt", async () => {
      const signAllTransactions = vi.fn();
      const signV1Transactions = vi.fn(async (txs: readonly Uint8Array[]) =>
        txs.map(() => v1Signed),
      );
      const execution = buildSvmTransactionMethods(
        wallet({ signAllTransactions, signV1Transactions }),
        { preferDirectSend: false, rpcHttpUrl: "https://solana.example" },
      );

      const signed = await execution.signAllSolanaTransactions!([
        { unsignedTx: v1Base64 },
        { unsignedTx: v1Base64 },
      ]);

      expect(signV1Transactions).toHaveBeenCalledOnce();
      expect(signAllTransactions).not.toHaveBeenCalled();
      expect(signed).toHaveLength(2);
    });

    it("sends signed v1 bytes raw and confirms the signature", async () => {
      const sendTransaction = vi.fn();
      const signV1Transactions = vi.fn(async (txs: readonly Uint8Array[]) =>
        txs.map(() => v1Signed),
      );
      const sendRawTransaction = vi
        .spyOn(Connection.prototype, "sendRawTransaction")
        .mockResolvedValue("v1-signature");
      const confirmTransaction = vi
        .spyOn(Connection.prototype, "confirmTransaction")
        .mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
      const execution = buildSvmTransactionMethods(
        wallet({ sendTransaction, signV1Transactions }),
        { preferDirectSend: true, rpcHttpUrl: "https://solana.example" },
      );

      const result = await execution.signAndSendSolanaTransaction!({
        unsignedTx: v1Base64,
      });

      expect(sendTransaction).not.toHaveBeenCalled();
      expect(sendRawTransaction).toHaveBeenCalledWith(v1Signed);
      expect(confirmTransaction).toHaveBeenCalledWith(
        "v1-signature",
        "confirmed",
      );
      expect(result.signature).toBe("v1-signature");
    });
  });
});

describe("sendSolana", () => {
  const devnet = {
    id: "solana-devnet",
    label: "Devnet",
    cluster: "solana:devnet" as const,
    rpcHttpUrl: "https://devnet.example",
  };
  const sender = (selectedSolanaNetwork?: typeof devnet) => {
    const signAndSendSolanaTransaction = vi.fn(async () => ({
      signature: "signature",
    }));
    return { signAndSendSolanaTransaction, selectedSolanaNetwork };
  };

  it("sends only on the cluster the transaction names", async () => {
    const onDevnet = sender(devnet);
    await expect(
      sendSolana(onDevnet, { unsignedTx: "dHg=", cluster: "solana:mainnet" }),
    ).rejects.toThrow(
      "This transaction is for solana:mainnet, and your Solana wallet here is on solana:devnet. Nothing was sent.",
    );
    // A cluster it cannot read is not the wallet's.
    await expect(
      sendSolana(onDevnet, { unsignedTx: "dHg=", cluster: "solana:localnet" }),
    ).rejects.toThrow(/Nothing was sent/);
    expect(onDevnet.signAndSendSolanaTransaction).not.toHaveBeenCalled();

    // Any spelling of the same cluster, and a payload that names none.
    await sendSolana(onDevnet, { unsignedTx: "dHg=", cluster: "devnet" });
    await sendSolana(onDevnet, { unsignedTx: "dHg=" });
    expect(onDevnet.signAndSendSolanaTransaction).toHaveBeenCalledTimes(2);

    // No network selected: the runtime's RPC is the default cluster's.
    const unset = sender();
    await sendSolana(unset, { unsignedTx: "dHg=", cluster: "mainnet-beta" });
    await expect(
      sendSolana(unset, { unsignedTx: "dHg=", cluster: "solana:devnet" }),
    ).rejects.toThrow(/Nothing was sent/);
    expect(unset.signAndSendSolanaTransaction).toHaveBeenCalledTimes(1);
  });
});
