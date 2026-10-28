// @vitest-environment node
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  createWalletClient,
  custom,
  http,
  parseTransaction,
  recoverMessageAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, mainnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { fileGrants } from "./node";
import { solanaSigner } from "./solana";
import { viemSigner } from "./viem";
import { isAomiError } from "./api-error";
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

  /** A browser wallet on `onChain` that may refuse to switch or bundle. */
  function browserWallet(
    options: {
      onChain?: number;
      switches?: boolean;
      capabilities?: unknown;
      callsStatus?: number;
    } = {},
  ) {
    let chain = options.onChain ?? 8453;
    const from = privateKeyToAccount(key).address;
    const request = vi.fn(
      async ({ method, params }: { method: string; params?: unknown }) => {
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "wallet_switchEthereumChain") {
          if (options.switches !== false)
            chain = Number((params as [{ chainId: string }])[0].chainId);
          return null;
        }
        if (method === "wallet_getCapabilities") {
          if (options.capabilities === "refuse")
            throw Object.assign(new Error("not implemented"), { code: -32004 });
          return (
            options.capabilities ?? {
              "0x2105": { atomic: { status: "supported" } },
            }
          );
        }
        if (method === "eth_sendTransaction") return "0xsent";
        if (method === "wallet_sendCalls") return { id: "bundle-1" };
        if (method === "wallet_getCallsStatus")
          return {
            version: "2.0.0",
            id: "bundle-1",
            chainId: "0x2105",
            status: options.callsStatus ?? 200,
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
      },
    );
    // The client is configured for mainnet; the wallet's own chain decides.
    const signer = viemSigner(
      createWalletClient({
        account: from,
        chain: mainnet,
        transport: custom({ request }),
      }),
    );
    const methods = () => request.mock.calls.map(([call]) => call.method);
    return { signer, from, request, methods };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve));
  const tx = (from: string, chainId: number) => ({
    kind: "evm_transaction" as const,
    chain_id: chainId,
    signer: from,
    nonce: 0,
    transaction: {
      to,
      value: "0",
      data: "0x",
      gas_limit: 21_000,
      max_fee_per_gas: "2",
      max_priority_fee_per_gas: "1",
    },
  });

  it("switches by the wallet's real chain and sends on the commit's chain", async () => {
    const { signer, from, methods } = browserWallet({ onChain: 8453 });
    await expect(signer.sendPreparedTransaction!(tx(from, 1))).resolves.toBe(
      "0xsent",
    );
    // Switched by what the wallet said, then viem checked the chain again
    // right before sending.
    expect(methods().slice(1)).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_chainId",
      "eth_sendTransaction",
    ]);
  });

  it("refuses to send when the wallet stays on another chain", async () => {
    const { signer, from, methods } = browserWallet({
      onChain: 8453,
      switches: false,
    });
    await expect(
      signer.sendPreparedTransaction!(tx(from, 1)),
    ).rejects.toSatisfy((error) => isAomiError(error, "wrong_chain"));
    expect(methods()).not.toContain("eth_sendTransaction");
  });

  it("bundles only where the wallet reported atomic batching", async () => {
    const { signer, from } = browserWallet();
    expect(signer.supportsAtomicBatch!(8453)).toBe(false);
    await flush();
    expect(signer.supportsAtomicBatch!(8453)).toBe(true);
    expect(signer.supportsAtomicBatch!(1)).toBe(false);
    await expect(
      signer.sendPreparedCalls!({
        kind: "wallet_calls",
        chain_id: 8453,
        signer: from,
        calls: [{ to, value: "0", data: "0x", gas_limit: 21_000 }],
      }),
    ).resolves.toEqual(["0xabc"]);

    const refusing = browserWallet({ capabilities: "refuse" });
    await flush();
    expect(refusing.signer.supportsAtomicBatch!(8453)).toBe(false);
  });

  it("throws when the bundle did not succeed", async () => {
    const { signer, from } = browserWallet({ callsStatus: 500 });
    await expect(
      signer.sendPreparedCalls!({
        kind: "wallet_calls",
        chain_id: 8453,
        signer: from,
        calls: [{ to, value: "0", data: "0x", gas_limit: 21_000 }],
      }),
    ).rejects.toSatisfy((error) => isAomiError(error, "calls_failed"));
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

  it("broadcasts through the RPC named for the commit's cluster", async () => {
    const endpoints: string[] = [];
    vi.spyOn(Connection.prototype, "sendRawTransaction").mockImplementation(
      async function (this: Connection) {
        endpoints.push(this.rpcEndpoint);
        return "sig";
      },
    );
    const signer = solanaSigner(Keypair.generate(), {
      rpcUrls: { "solana:devnet": "https://devnet.example" },
    });
    await signer.broadcastTransaction!("AA==", "solana:devnet");
    await signer.broadcastTransaction!("AA==", "solana:mainnet");
    expect(endpoints).toEqual([
      "https://devnet.example",
      "https://api.mainnet-beta.solana.com/",
    ]);
    vi.restoreAllMocks();
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
