import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  TransactionNotFoundError,
} from "viem";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { CommitView } from "../../src/commits";

const signer = "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c";
const privateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const originalEnv = { ...process.env };

function commit(id: string, threadId: string): CommitView {
  return {
    version: 1,
    commit_id: id,
    thread_id: threadId,
    stage_id: "evm:1",
    chain_family: "evm",
    chain_ref: "1",
    signer,
    broadcaster: "hosted",
    state: "needs_signature",
    transaction_id: null,
    failure_code: null,
    batch: null,
    wallet_attempt: null,
    review: {
      version: 1,
      revision: 1,
      digest: "review-1",
      request: {
        type: "execute_evm",
        transactions: [
          {
            chain_id: 1,
            from: signer,
            to: "0x1111111111111111111111111111111111111111",
            data: "0x",
            label: "Prepared operation",
            kind: "transaction",
          },
        ],
        simulation: {
          status: "passed",
          balanceChanges: [],
          approvals: [],
          warnings: [],
          fees: [],
          guards: [],
          gas: null,
          logs: [],
        },
      },
      legs: [],
    },
    action: {
      kind: "sign",
      payload: {
        kind: "user_operation",
        chain_id: 1,
        signer,
        requests: [
          { kind: "personal_sign", message: "0x0102", raw_payload: "0x0102" },
        ],
      },
    },
  };
}

describe("CLI durable commits", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-commits-"));
    process.env.AOMI_STATE_DIR = stateDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("lists, signs, and rejects durable commits without a legacy Action", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { txCommand, signCommand, rejectCommand } =
      await import("../../src/cli/commands/wallet");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const session = cli.createClientSession({ privateKey });
    session.commits.ingest(commit("commit-1", cli.sessionId));
    session.commits.ingest(commit("commit-2", cli.sessionId));
    vi.spyOn(CliSession, "load").mockReturnValue(cli);
    vi.spyOn(cli, "createClientSession").mockReturnValue(session);
    vi.spyOn(session, "fetchCurrentState").mockResolvedValue();
    vi.spyOn(session, "close").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const execute = vi.spyOn(session.commits, "execute").mockResolvedValue({
      ...commit("commit-1", cli.sessionId),
      state: "submitted",
    });
    const reject = vi.spyOn(session.commits, "reject").mockResolvedValue({
      ...commit("commit-2", cli.sessionId),
      state: "rejected",
    });

    await txCommand({ secrets: {} });
    expect(log.mock.calls.flat().join(" ")).toContain("commit-1");
    await signCommand({ secrets: {} }, ["commit-1"]);
    await rejectCommand({ secrets: {} }, ["commit-2"]);
    expect(execute).toHaveBeenCalledWith("commit-1", {
      expectedVersion: 1,
      expectedReviewDigest: "review-1",
    });
    expect(reject).toHaveBeenCalledWith("commit-2");
  });

  it("preflights every selection and executes selected batch commits in order", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { signCommand } = await import("../../src/cli/commands/wallet");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const session = cli.createClientSession({ privateKey });
    const batch = (id: string, index: number): CommitView => ({
      ...commit(id, cli.sessionId),
      batch: {
        batch_id: "batch-1",
        index,
        ordered_stage_ids: ["stage-1", "stage-2"],
        ordered_commit_ids: ["commit-1", "commit-2"],
        sources: [],
        predecessor_commit_id: index === 0 ? null : "commit-1",
        review_digest: "review-1",
      },
    });
    session.commits.ingest(batch("commit-1", 0));
    session.commits.ingest(batch("commit-2", 1));
    vi.spyOn(CliSession, "load").mockReturnValue(cli);
    vi.spyOn(cli, "createClientSession").mockReturnValue(session);
    vi.spyOn(session, "fetchCurrentState").mockResolvedValue();
    vi.spyOn(session, "close").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const execute = vi
      .spyOn(session.commits, "execute")
      .mockImplementation(async (id) => ({
        ...commit(id, cli.sessionId),
        state: "submitted",
      }));
    const refresh = vi.spyOn(session.commits, "refresh").mockResolvedValue({
      ...batch("commit-1", 0),
      state: "confirmed",
    });

    await signCommand({ secrets: {} }, ["commit-2", "commit-1"]);
    expect(execute.mock.calls.map(([id]) => id)).toEqual([
      "commit-1",
      "commit-2",
    ]);
    expect(refresh).toHaveBeenCalledWith("commit-1");

    process.env.AOMI_CLI_STRICT_EXIT = "1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockClear();
    session.commits.ingest({
      ...batch("commit-2", 1),
      version: 2,
      signer: "0x2222222222222222222222222222222222222222",
    });
    await expect(
      signCommand({ secrets: {} }, ["commit-1", "commit-2"]),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("waits for batch predecessor confirmation before signing the successor", async () => {
    process.env.AOMI_CLI_STRICT_EXIT = "1";
    const { CliSession } = await import("../../src/cli/cli-session");
    const { signCommand } = await import("../../src/cli/commands/wallet");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const session = cli.createClientSession({ privateKey });
    const first = commit("commit-1", cli.sessionId);
    const second: CommitView = {
      ...commit("commit-2", cli.sessionId),
      batch: {
        batch_id: "batch-1",
        index: 1,
        ordered_stage_ids: ["stage-1", "stage-2"],
        ordered_commit_ids: ["commit-1", "commit-2"],
        sources: [],
        predecessor_commit_id: "commit-1",
        review_digest: "review-1",
      },
    };
    session.commits.ingest(first);
    session.commits.ingest(second);
    vi.spyOn(CliSession, "load").mockReturnValue(cli);
    vi.spyOn(cli, "createClientSession").mockReturnValue(session);
    vi.spyOn(session, "fetchCurrentState").mockResolvedValue();
    vi.spyOn(session, "close").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const execute = vi.spyOn(session.commits, "execute").mockResolvedValue({
      ...first,
      state: "submitted",
    });
    vi.spyOn(session.commits, "refresh").mockResolvedValue({
      ...first,
      state: "submitted",
    });

    await expect(
      signCommand({ secrets: {} }, ["commit-2", "commit-1"]),
    ).rejects.toThrow();
    expect(execute.mock.calls.map(([id]) => id)).toEqual(["commit-1"]);
    expect(error.mock.calls.flat().join(" ")).toContain(
      "Wait for confirmation",
    );
  });

  it("exports the exact commit and submits only matching externally signed bytes", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { exportCommand } = await import("../../src/cli/commands/export");
    const { submitCommand } = await import("../../src/cli/commands/submit");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const session = cli.createClientSession();
    const view = commit("commit-1", cli.sessionId);
    session.commits.ingest(view);
    vi.spyOn(CliSession, "load").mockReturnValue(cli);
    vi.spyOn(cli, "createClientSession").mockReturnValue(session);
    vi.spyOn(session, "fetchCurrentState").mockResolvedValue();
    vi.spyOn(session, "close").mockImplementation(() => {});
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const submit = vi.spyOn(session.commits, "submitSigned").mockResolvedValue({
      ...view,
      state: "awaiting_broadcast",
    });

    await exportCommand({ secrets: {} }, ["commit-1"], "commit");
    const exported = JSON.parse(String(write.mock.calls[0][0]));
    expect(exported).toEqual({ format: "aomi.commit.v1", commit: view });
    const signedFile = join(stateDir, "signed.json");
    writeFileSync(
      signedFile,
      JSON.stringify({ ...exported, payloads: ["0xsignature"] }),
    );
    await submitCommand({ secrets: {} }, "commit-1", { signedFile });
    expect(submit).toHaveBeenCalledWith("commit-1", ["0xsignature"], {
      expectedVersion: 1,
      expectedReviewDigest: "review-1",
    });

    process.env.AOMI_CLI_STRICT_EXIT = "1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    submit.mockClear();
    const tampered = structuredClone(exported);
    tampered.commit.action.payload.requests[0].message = "0xdeadbeef";
    writeFileSync(
      signedFile,
      JSON.stringify({ ...tampered, payloads: ["0xsignature"] }),
    );
    await expect(
      submitCommand({ secrets: {} }, "commit-1", { signedFile }),
    ).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports only the prepared hash for an externally broadcast commit", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { submitCommand } = await import("../../src/cli/commands/submit");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const session = cli.createClientSession();
    const view: CommitView = {
      ...commit("commit-1", cli.sessionId),
      version: 2,
      state: "awaiting_broadcast",
      action: {
        kind: "broadcast",
        signed_transaction: "0x0102",
        transaction_id: "0xprepared",
      },
    };
    session.commits.ingest(view);
    vi.spyOn(CliSession, "load").mockReturnValue(cli);
    vi.spyOn(cli, "createClientSession").mockReturnValue(session);
    vi.spyOn(session, "fetchCurrentState").mockResolvedValue();
    vi.spyOn(session, "close").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const report = vi
      .spyOn(session.commits, "submitBroadcast")
      .mockResolvedValue({
        ...view,
        state: "submitted",
      });

    await submitCommand({ secrets: {} }, "commit-1", { txHash: "0xprepared" });
    expect(report).toHaveBeenCalledWith("commit-1", "0xprepared", {
      expectedVersion: 2,
      expectedReviewDigest: "review-1",
    });
    process.env.AOMI_CLI_STRICT_EXIT = "1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    report.mockClear();
    await expect(
      submitCommand({ secrets: {} }, "commit-1", { txHash: "0xother" }),
    ).rejects.toThrow();
    expect(report).not.toHaveBeenCalled();
  });

  it("accepts an already confirmed commit only for its exact reported hash", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { submitCommand } = await import("../../src/cli/commands/submit");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const session = cli.createClientSession();
    const confirmed: CommitView = {
      ...commit("commit-1", cli.sessionId),
      version: 3,
      state: "confirmed",
      transaction_id: "0xprepared",
      action: null,
    };
    session.commits.ingest(confirmed);
    vi.spyOn(CliSession, "load").mockReturnValue(cli);
    vi.spyOn(cli, "createClientSession").mockReturnValue(session);
    vi.spyOn(session, "fetchCurrentState").mockResolvedValue();
    vi.spyOn(session, "close").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const report = vi
      .spyOn(session.commits, "submitBroadcast")
      .mockResolvedValue(confirmed);

    await submitCommand({ secrets: {} }, "commit-1", { txHash: "0xprepared" });
    expect(report).toHaveBeenCalledWith("commit-1", "0xprepared", {
      expectedVersion: 3,
      expectedReviewDigest: "review-1",
    });

    process.env.AOMI_CLI_STRICT_EXIT = "1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    report.mockClear();
    await expect(
      submitCommand({ secrets: {} }, "commit-1", { txHash: "0xother" }),
    ).rejects.toThrow();
    expect(report).not.toHaveBeenCalled();
  });

  it("keeps a keyless commit unavailable for local signing", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const session = cli.createClientSession();
    const view = commit("commit-1", cli.sessionId);
    session.commits.ingest(view);
    expect(session.commits.canExecute(view)).toBe(false);
    session.close();
  });

  it("signs the exact prepared EVM fields without submitting", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { cliWallets } = await import("../../src/cli/action-capabilities");
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const wallet = cliWallets(cli, { privateKey }).evm!;
    const payload = {
      kind: "evm_transaction" as const,
      chain_id: 1,
      signer,
      nonce: 7,
      transaction: {
        to: "0x1111111111111111111111111111111111111111",
        value: "42",
        data: "0xaabb",
        gas_limit: 45_000,
        max_fee_per_gas: "1000000000",
        max_priority_fee_per_gas: "100000000",
      },
    };
    const raw = await wallet.signTransaction!(payload);
    const parsed = parseTransaction(raw as `0x${string}`);
    expect(parsed).toMatchObject({
      type: "eip1559",
      chainId: 1,
      nonce: 7,
      to: payload.transaction.to,
      data: payload.transaction.data,
      value: 42n,
      gas: 45_000n,
    });
    expect(
      await recoverTransactionAddress({
        serializedTransaction: raw as `0x${string}`,
      }),
    ).toBe(signer);
    await expect(
      wallet.signTransaction!({
        ...payload,
        signer: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow("signer");
  });

  it("does not rebroadcast prepared EVM bytes already known to the chain", async () => {
    const { broadcastPreparedTransaction } =
      await import("../../src/cli/action-capabilities");
    const raw = "0x0102";
    const hash = keccak256(raw);
    const client = {
      getTransaction: vi.fn().mockResolvedValue({ hash }),
      sendRawTransaction: vi.fn(),
    };

    await expect(broadcastPreparedTransaction(client, raw)).resolves.toBe(hash);
    expect(client.getTransaction).toHaveBeenCalledWith({ hash });
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("accepts an ambiguous raw broadcast error only after the exact hash is found", async () => {
    const { broadcastPreparedTransaction } =
      await import("../../src/cli/action-capabilities");
    const raw = "0x0102";
    const hash = keccak256(raw);
    const client = {
      getTransaction: vi
        .fn()
        .mockRejectedValueOnce(new TransactionNotFoundError({ hash }))
        .mockResolvedValueOnce({ hash }),
      sendRawTransaction: vi.fn().mockRejectedValue(new Error("RPC timed out")),
    };

    await expect(broadcastPreparedTransaction(client, raw)).resolves.toBe(hash);
    expect(client.getTransaction).toHaveBeenCalledTimes(2);
    expect(client.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("surfaces an unknown raw broadcast error without claiming submission", async () => {
    const { broadcastPreparedTransaction } =
      await import("../../src/cli/action-capabilities");
    const raw = "0x0102";
    const hash = keccak256(raw);
    const client = {
      getTransaction: vi
        .fn()
        .mockRejectedValue(new TransactionNotFoundError({ hash })),
      sendRawTransaction: vi
        .fn()
        .mockRejectedValue(new Error("RPC unavailable")),
    };

    await expect(broadcastPreparedTransaction(client, raw)).rejects.toThrow(
      "RPC unavailable",
    );
    expect(client.getTransaction).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the preflight transaction lookup is unavailable", async () => {
    const { broadcastPreparedTransaction } =
      await import("../../src/cli/action-capabilities");
    const client = {
      getTransaction: vi
        .fn()
        .mockRejectedValue(new Error("lookup unavailable")),
      sendRawTransaction: vi.fn(),
    };

    await expect(
      broadcastPreparedTransaction(client, "0x0102"),
    ).rejects.toThrow("lookup unavailable");
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("passes signed Solana bytes to the raw broadcaster", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { cliWallets } = await import("../../src/cli/action-capabilities");
    const keypair = Keypair.fromSeed(new Uint8Array(32).fill(7));
    const cli = CliSession.create({
      baseUrl: "https://example.test",
      secrets: {},
    });
    const wallet = cliWallets(cli, {
      solanaPrivateKey: bs58.encode(keypair.secretKey),
    }).svm!;
    const raw = Buffer.from([1, 2, 3]).toString("base64");
    const broadcast = vi
      .spyOn(Connection.prototype, "sendRawTransaction")
      .mockResolvedValue("signature-1");
    expect(await wallet.broadcastTransaction!(raw, "solana:devnet")).toBe(
      "signature-1",
    );
    expect(Buffer.from(broadcast.mock.calls[0][0]).toString("base64")).toBe(
      raw,
    );
  });
});
