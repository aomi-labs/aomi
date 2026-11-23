// @vitest-environment node
import { createPrivateKey, sign as ed25519Sign } from "node:crypto";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  paraSvmWallet,
  signParaSolanaTransaction,
} from "./para-solana-transactions";

const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/** A Para session holding `owner` as its Solana wallet, signing like Para. */
function paraFor(owner: Keypair) {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, owner.secretKey.subarray(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
  const signMessage = vi.fn(
    async ({ messageBase64 }: { walletId: string; messageBase64: string }) => ({
      signature: ed25519Sign(
        null,
        Buffer.from(messageBase64, "base64"),
        key,
      ).toString("base64"),
    }),
  );
  return {
    signMessage,
    para: {
      signMessage,
      wallets: {
        sol: {
          id: "sol",
          address: owner.publicKey.toBase58(),
          type: "SOLANA",
        },
      },
    },
  };
}

const transfer = (from: Keypair) =>
  SystemProgram.transfer({
    fromPubkey: from.publicKey,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  });

function legacy(payer: Keypair) {
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: BLOCKHASH,
  });
  return tx.add(transfer(payer));
}

const versioned = (payer: Keypair) =>
  new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [transfer(payer)],
    }).compileToV0Message(),
  );

describe("Para embedded Solana transactions", () => {
  it("signs a legacy transaction's message with the Para wallet", async () => {
    const owner = Keypair.generate();
    const { para, signMessage } = paraFor(owner);
    const tx = legacy(owner);

    const signed = await signParaSolanaTransaction(
      para,
      owner.publicKey.toBase58(),
      tx,
    );

    expect(signMessage).toHaveBeenCalledWith({
      walletId: "sol",
      messageBase64: tx.serializeMessage().toString("base64"),
    });
    expect(signed.verifySignatures()).toBe(true);
  });

  it("signs a versioned transaction so it serializes fully signed", async () => {
    const owner = Keypair.generate();
    const { para } = paraFor(owner);

    const signed = await signParaSolanaTransaction(
      para,
      owner.publicKey.toBase58(),
      versioned(owner),
    );

    const reference = new VersionedTransaction(signed.message);
    reference.sign([owner]);
    expect(Buffer.from(signed.signatures[0]!)).toEqual(
      Buffer.from(reference.signatures[0]!),
    );
  });

  it("refuses a transaction the Para wallet does not sign", async () => {
    const owner = Keypair.generate();
    const { para, signMessage } = paraFor(owner);

    await expect(
      signParaSolanaTransaction(
        para,
        owner.publicKey.toBase58(),
        legacy(Keypair.generate()),
      ),
    ).rejects.toThrow("another wallet");
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("sends the signed transaction through the given connection", async () => {
    const owner = Keypair.generate();
    const { para } = paraFor(owner);
    const sendRawTransaction = vi.fn(async (_: Uint8Array) => "sig");
    const wallet = paraSvmWallet(para, owner.publicKey.toBase58());

    await expect(
      wallet.sendTransaction!(legacy(owner), {
        sendRawTransaction,
      } as unknown as Connection),
    ).resolves.toBe("sig");

    const sent = Transaction.from(sendRawTransaction.mock.calls[0]![0]);
    expect(sent.verifySignatures()).toBe(true);
  });
});
