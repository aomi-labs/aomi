// @vitest-environment node
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  createWalletClient,
  custom,
  http,
  parseTransaction,
  recoverMessageAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { fileGrants } from "./node";
import { solanaSigner } from "./solana";
import { viemSigner } from "./viem";
import type { AomiOAuthGrant } from "./authorization";

const key =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const to = "0x2222222222222222222222222222222222222222";

describe("viemSigner", () => {
  it("signs a commit transaction and messages with a local key", async () => {
    const account = privateKeyToAccount(key);
    const signer = viemSigner(
      createWalletClient({ account, chain: base, transport: http() }),
    );
    expect(signer.address).toBe(account.address);
    expect(signer.sendPreparedTransaction).toBeUndefined();

    const signed = await signer.signTransaction!({
      kind: "evm_transaction",
      chain_id: 8453,
      signer: account.address,
      nonce: 7,
      transaction: {
        to,
        value: "1",
        data: "0x",
        gas_limit: 21_000,
        max_fee_per_gas: "2",
        max_priority_fee_per_gas: "1",
      },
    });
    expect(parseTransaction(signed as `0x${string}`)).toMatchObject({
      chainId: 8453,
      nonce: 7,
      to,
      value: 1n,
    });

    const signature = await signer.signMessage!({ message: "hello" });
    expect(
      await recoverMessageAddress({
        message: "hello",
        signature: signature as `0x${string}`,
      }),
    ).toBe(account.address);
  });

  it("bundles with wallet_sendCalls and stops asking a wallet that refuses", async () => {
    const from = privateKeyToAccount(key).address;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x2105";
      if (method === "wallet_sendCalls") {
        if (request.mock.calls.length > 3)
          throw Object.assign(new Error("unsupported"), { code: 4200 });
        return { id: "bundle-1" };
      }
      if (method === "wallet_getCallsStatus")
        return {
          version: "2.0.0",
          id: "bundle-1",
          chainId: "0x2105",
          status: 200,
          atomic: true,
          receipts: [
            {
              transactionHash: "0xabc",
              status: "0x1",
              logs: [],
              blockHash: "0x01",
              blockNumber: "0x1",
              gasUsed: "0x5208",
            },
          ],
        };
      throw new Error(`unexpected ${method}`);
    });
    const signer = viemSigner(
      createWalletClient({ account: from, transport: custom({ request }) }),
    );
    const calls = {
      kind: "wallet_calls" as const,
      chain_id: 8453,
      signer: from,
      calls: [{ to, value: "0", data: "0x", gas_limit: 21_000 }],
    };

    expect(signer.supportsAtomicBatch!(8453)).toBe(true);
    await expect(signer.sendPreparedCalls!(calls)).resolves.toEqual(["0xabc"]);
    await expect(signer.sendPreparedCalls!(calls)).rejects.toThrow();
    expect(signer.supportsAtomicBatch!(8453)).toBe(false);
  });
});

describe("solanaSigner", () => {
  it("signs transactions and messages with a keypair or its secret", async () => {
    const keypair = Keypair.generate();
    const signer = solanaSigner(JSON.stringify([...keypair.secretKey]));
    expect(signer.address).toBe(keypair.publicKey.toBase58());

    const tx = new Transaction({
      feePayer: keypair.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
    }).add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );
    const unsigned = tx
      .serialize({ requireAllSignatures: false })
      .toString("base64");
    const signed = await signer.signTransaction!({
      transactionBase64: unsigned,
    });
    const bytes = Buffer.from(
      (signed as { signedTransaction: string }).signedTransaction,
      "base64",
    );
    expect(Transaction.from(bytes).verifySignatures()).toBe(true);

    const message = Buffer.from("hi").toString("base64");
    const { signature } = (await signer.signMessage!({
      messageBase64: message,
    })) as { signature: string };
    expect(
      nacl.sign.detached.verify(
        Buffer.from("hi"),
        Buffer.from(signature, "base64"),
        keypair.publicKey.toBytes(),
      ),
    ).toBe(true);
    expect(() => solanaSigner("[1,2]")).toThrow(/64 bytes/);
  });
});

describe("fileGrants", () => {
  it("keeps grants in a private file across stores", async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), "aomi-")),
      "aomi",
      "grants.json",
    );
    const grant = {
      issuer: "https://chat.example",
      clientId: "c",
      accessToken: "t",
      expiresAt: 1,
      resource: "https://chat.example/v1",
      scopes: ["agent:read"],
    } as AomiOAuthGrant;

    await expect(fileGrants(path).load()).resolves.toEqual([]);
    await fileGrants(path).save([grant]);
    await expect(fileGrants(path).load()).resolves.toEqual([grant]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveLength(1);
  });
});
