// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  executeE2ESolanaTransaction,
  executeE2EvmTransaction,
  isE2EWalletEnabled,
  mintE2EWalletCookie,
  signE2ESolanaMessage,
  verifyE2EWalletCookie,
} from "./e2e-wallet";

function enableSolanaWallet(signer: Keypair) {
  vi.stubEnv("AOMI_ENABLE_E2E_WALLET", "true");
  vi.stubEnv("AOMI_E2E_WALLET_TOKEN", "unit-test-token");
  vi.stubEnv("AOMI_E2E_EXECUTION_MODE", "real");
  vi.stubEnv(
    "AOMI_E2E_SOLANA_SIGNER_PRIVATE_KEY",
    bs58.encode(signer.secretKey),
  );
  vi.stubEnv("AOMI_E2E_SOLANA_RPC_URL", "http://127.0.0.1:8899");
}

describe("Solana E2E wallet boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("mints and verifies a Solana-only seed", () => {
    const signer = Keypair.generate();
    enableSolanaWallet(signer);
    const cookie = mintE2EWalletCookie({
      svmAddress: signer.publicKey.toBase58(),
      svmCluster: "solana:devnet",
      ttlSeconds: 60,
    });
    expect(cookie).toBeTruthy();
    expect(verifyE2EWalletCookie(cookie ?? undefined)).toMatchObject({
      svmAddress: signer.publicKey.toBase58(),
      svmCluster: "solana:devnet",
    });
  });

  it("mints and verifies a mainnet-fork seed", () => {
    // "solana:mainnet" = the LOCAL Surfpool mirror, never the real cluster —
    // the executor's loopback-only RPC rule holds for every cluster value.
    const signer = Keypair.generate();
    enableSolanaWallet(signer);
    const cookie = mintE2EWalletCookie({
      svmAddress: signer.publicKey.toBase58(),
      svmCluster: "solana:mainnet",
      ttlSeconds: 60,
    });
    expect(cookie).toBeTruthy();
    expect(verifyE2EWalletCookie(cookie ?? undefined)).toMatchObject({
      svmAddress: signer.publicKey.toBase58(),
      svmCluster: "solana:mainnet",
    });
  });

  it("signs binding messages under a mainnet-fork seed", async () => {
    const signer = Keypair.generate();
    enableSolanaWallet(signer);
    const message = Buffer.from("bind me").toString("base64");
    const result = await signE2ESolanaMessage({
      seed: {
        svmAddress: signer.publicKey.toBase58(),
        svmCluster: "solana:mainnet",
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      message,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const verified = nacl.sign.detached.verify(
        Buffer.from("bind me"),
        Buffer.from(result.signature, "base64"),
        signer.publicKey.toBytes(),
      );
      expect(verified).toBe(true);
    }
  });

  it("cannot be enabled in production or a Vercel deployment", () => {
    enableSolanaWallet(Keypair.generate());
    vi.stubEnv("NODE_ENV", "production");
    expect(isE2EWalletEnabled()).toBe(false);

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isE2EWalletEnabled()).toBe(false);
  });

  it("signs binding messages with the seeded Ed25519 key", async () => {
    const signer = Keypair.generate();
    enableSolanaWallet(signer);
    const message = new TextEncoder().encode("bind this wallet");
    const result = await signE2ESolanaMessage({
      seed: {
        svmAddress: signer.publicKey.toBase58(),
        svmCluster: "solana:devnet",
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      message: Buffer.from(message).toString("base64"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        nacl.sign.detached.verify(
          message,
          Buffer.from(result.signature, "base64"),
          signer.publicKey.toBytes(),
        ),
      ).toBe(true);
    }
  });

  it("signs an unsigned versioned transaction without broadcasting", async () => {
    const signer = Keypair.generate();
    enableSolanaWallet(signer);
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1_000_000,
        }),
      ],
    }).compileToV0Message();
    const unsigned = new VersionedTransaction(message);

    const result = await executeE2ESolanaTransaction({
      seed: {
        svmAddress: signer.publicKey.toBase58(),
        svmCluster: "solana:devnet",
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      payload: {
        cluster: "devnet",
        unsignedTx: Buffer.from(unsigned.serialize()).toString("base64"),
      },
      broadcast: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.signedTx) {
      const signed = VersionedTransaction.deserialize(
        Buffer.from(result.signedTx, "base64"),
      );
      expect(signed.signatures[0]?.some((byte) => byte !== 0)).toBe(true);
    }
  });

  it("refuses a non-loopback RPC", async () => {
    const signer = Keypair.generate();
    enableSolanaWallet(signer);
    vi.stubEnv(
      "AOMI_E2E_SOLANA_RPC_URL",
      "https://api.mainnet-beta.solana.com",
    );
    const result = await signE2ESolanaMessage({
      seed: {
        svmAddress: signer.publicKey.toBase58(),
        svmCluster: "solana:devnet",
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      message: Buffer.from("blocked").toString("base64"),
    });
    expect(result).toMatchObject({ ok: false, code: "disabled" });
  });
});

describe("EVM E2E executor fork gate", () => {
  // Anvil's well-known dev account 2 — public knowledge, never a secret.
  const DEMO_KEY =
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
  const DEMO_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const OTHER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  function enableEvmExecutor() {
    vi.stubEnv("AOMI_ENABLE_E2E_WALLET", "true");
    vi.stubEnv("AOMI_E2E_WALLET_TOKEN", "unit-test-token");
    vi.stubEnv("AOMI_E2E_EXECUTION_MODE", "real");
    vi.stubEnv("AOMI_E2E_SIGNER_PRIVATE_KEY", DEMO_KEY);
    vi.stubEnv("AOMI_E2E_RPC_URL_1", "http://127.0.0.1:59999");
  }

  function seed() {
    return {
      address: DEMO_ADDRESS as `0x${string}`,
      chainId: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
  }

  function contractCallPayload() {
    return {
      chainId: 1,
      calls: [
        {
          to: OTHER_ADDRESS,
          value: "0x0de0b6b3a7640000",
          data: "0xa1903eab0000000000000000000000000000000000000000000000000000000000000000",
          chainId: 1,
        },
      ],
    } as never;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("still rejects contract calls when the RPC is NOT a proven anvil fork", async () => {
    enableEvmExecutor();
    // A real RPC rejects anvil_nodeInfo — the gate must fail closed and the
    // original self-transfer-only posture must hold.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } }),
      ),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: contractCallPayload(),
    });
    expect(result).toMatchObject({ ok: false, code: "policy_rejected" });
  });

  it("fails closed when the fork probe itself errors", async () => {
    enableEvmExecutor();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: contractCallPayload(),
    });
    expect(result).toMatchObject({ ok: false, code: "policy_rejected" });
  });

  it("enforces the value cap even on a proven fork", async () => {
    enableEvmExecutor();
    vi.stubEnv("AOMI_E2E_MAX_NATIVE_WEI", "1000");
    // The probe says "anvil" — but the value cap must still bind.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: { forkConfig: {} } }),
      ),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: contractCallPayload(),
    });
    expect(result).toMatchObject({ ok: false, code: "policy_rejected" });
  });
});

describe("EVM E2E executor batching", () => {
  const DEMO_KEY =
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
  const DEMO_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  function enable() {
    vi.stubEnv("AOMI_ENABLE_E2E_WALLET", "true");
    vi.stubEnv("AOMI_E2E_WALLET_TOKEN", "unit-test-token");
    vi.stubEnv("AOMI_E2E_EXECUTION_MODE", "real");
    vi.stubEnv("AOMI_E2E_SIGNER_PRIVATE_KEY", DEMO_KEY);
    vi.stubEnv("AOMI_E2E_RPC_URL_1", "http://127.0.0.1:59999");
  }

  const seed = () => ({
    address: DEMO_ADDRESS as `0x${string}`,
    chainId: 1,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  });

  /** approve + supply: the shape that was silently unsupported. */
  const batch = () =>
    ({
      chainId: 1,
      calls: [
        { to: OTHER, value: "0x0", data: "0x095ea7b3", chainId: 1 },
        { to: OTHER, value: "0x0", data: "0x617ba037", chainId: 1 },
      ],
    }) as never;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses a batch when the RPC is not a proven fork", async () => {
    enable();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } }),
      ),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: batch(),
    });
    expect(result).toMatchObject({ ok: false, code: "policy_rejected" });
  });

  /** The cap must bind the SUM, not each leg — two legs under it are not ok. */
  it("applies the value cap across the whole batch", async () => {
    enable();
    vi.stubEnv("AOMI_E2E_MAX_NATIVE_WEI", "150");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: { forkConfig: {} } }),
      ),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: {
        chainId: 1,
        calls: [
          { to: OTHER, value: "0x64", data: "0x", chainId: 1 }, // 100
          { to: OTHER, value: "0x64", data: "0x", chainId: 1 }, // 100 -> 200 > 150
        ],
      } as never,
    });
    expect(result).toMatchObject({ ok: false, code: "policy_rejected" });
  });

  /**
   * The staged-tx-loss regression: a 6-leg batch landed its first leg (a
   * 5 ETH Lido stake), the borrow leg reverted at estimation, and the
   * blanket failure report made the backend re-queue EVERY leg — the
   * retry re-ran the stake against the already-debited balance. A
   * mid-batch failure must report which txIds mined, which failed, and
   * which were never attempted.
   */
  it("reports partial execution when a later leg fails", async () => {
    enable();
    const RECEIPT_HASH = `0x${"ab".repeat(32)}`;
    let sends = 0;
    let estimates = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          id?: number;
        };
        const ok = (result: unknown) =>
          Response.json({ jsonrpc: "2.0", id: body.id ?? 1, result });
        switch (body.method) {
          case "anvil_nodeInfo":
            return ok({ forkConfig: {} });
          case "eth_chainId":
            return ok("0x1");
          case "eth_getTransactionCount":
            return ok("0x0");
          case "eth_gasPrice":
          case "eth_maxPriorityFeePerGas":
            return ok("0x1");
          case "eth_getBlockByNumber":
            return ok({
              number: "0x1",
              hash: `0x${"11".repeat(32)}`,
              parentHash: `0x${"22".repeat(32)}`,
              baseFeePerGas: "0x1",
              gasLimit: "0x1c9c380",
              gasUsed: "0x0",
              timestamp: "0x1",
              transactions: [],
              logsBloom: `0x${"00".repeat(256)}`,
              miner: DEMO_ADDRESS,
              difficulty: "0x0",
              totalDifficulty: "0x0",
              extraData: "0x",
              nonce: "0x0000000000000000",
              receiptsRoot: `0x${"33".repeat(32)}`,
              sha3Uncles: `0x${"44".repeat(32)}`,
              size: "0x0",
              stateRoot: `0x${"55".repeat(32)}`,
              transactionsRoot: `0x${"66".repeat(32)}`,
              uncles: [],
            });
          case "eth_estimateGas":
            estimates += 1;
            // First leg estimates fine; the second reverts (the borrow).
            if (estimates >= 2) {
              return Response.json({
                jsonrpc: "2.0",
                id: body.id ?? 1,
                error: {
                  code: 3,
                  message: "execution reverted: custom error 0x5b263df7",
                },
              });
            }
            return ok("0x5208");
          case "eth_sendRawTransaction":
            sends += 1;
            return ok(RECEIPT_HASH);
          case "eth_getTransactionReceipt":
            return ok({
              transactionHash: RECEIPT_HASH,
              transactionIndex: "0x0",
              blockHash: `0x${"11".repeat(32)}`,
              blockNumber: "0x1",
              from: DEMO_ADDRESS,
              to: OTHER,
              cumulativeGasUsed: "0x5208",
              gasUsed: "0x5208",
              contractAddress: null,
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              status: "0x1",
              effectiveGasPrice: "0x1",
              type: "0x2",
            });
          default:
            return ok(null);
        }
      }),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: {
        chainId: 1,
        calls: [
          { to: OTHER, value: "0x0", data: "0xd0e30db0", chainId: 1, txId: 7 },
          { to: OTHER, value: "0x0", data: "0xa415bcad", chainId: 1, txId: 8 },
          { to: OTHER, value: "0x0", data: "0x095ea7b3", chainId: 1, txId: 9 },
        ],
      } as never,
    });
    expect(sends).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      code: "execution_failed",
      partial: {
        executedTxIds: [7],
        lastTxHash: RECEIPT_HASH,
        failedTxId: 8,
        remainingTxIds: [9],
      },
    });
  });

  it("rejects a batch that spans multiple chains", async () => {
    enable();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: { forkConfig: {} } }),
      ),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: {
        chainId: 1,
        calls: [
          { to: OTHER, value: "0x0", data: "0x", chainId: 1 },
          { to: OTHER, value: "0x0", data: "0x", chainId: 8453 },
        ],
      } as never,
    });
    expect(result).toMatchObject({ ok: false, code: "policy_rejected" });
  });

  /**
   * The wallet is multi-chain: a single-chain batch on a chain OTHER than
   * the seed's must clear the chain gate and be judged by configuration +
   * the fork probe like any other. Pinning execution to the seed chain
   * killed every cross-chain scenario's far leg (the bridge round-trip's
   * Base-side return deposit died with "does not match seed" while the
   * agent told the camera the funds were on their way).
   */
  it("executes on a non-seed chain that has its own configured fork", async () => {
    enable();
    // Seeded on chain 1; the batch targets chain 8453. No RPC URL is
    // configured for 8453 here, so passing the chain gate surfaces as
    // rpc_unavailable — NOT the old "does not match seed" policy reject.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: { forkConfig: {} } }),
      ),
    );
    const result = await executeE2EvmTransaction({
      seed: seed(),
      payload: {
        chainId: 8453,
        calls: [{ to: OTHER, value: "0x0", data: "0x", chainId: 8453 }],
      } as never,
    });
    expect(result).toMatchObject({ ok: false, code: "rpc_unavailable" });
  });
});
