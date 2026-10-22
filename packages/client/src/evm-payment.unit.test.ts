// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  getAddress,
} from "viem";
import { EvmPayment, type EvmFundingSource } from "./evm-payment";
import type { CommitView } from "./commits";

const sender = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const token = getAddress("0x3333333333333333333333333333333333333333");
const other = getAddress("0x4444444444444444444444444444444444444444");
const hash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const asset = { chainId: 1, token, decimals: 6 };
const intent = { asset, sender, recipient, amount: "1500" };
const rpcUrl = "https://rpc.example?key=private-rpc-key";
const hex = (value: bigint) => `0x${value.toString(16)}`;
const data = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [recipient, 1_500_000_000n],
});
const source = (
  role: EvmFundingSource["role"] = "operational",
): EvmFundingSource => ({ address: sender, role, asset, rpcUrl });
function commit(state: CommitView["state"] = "submitted"): CommitView {
  return {
    commit_id: "payment-1",
    thread_id: "thread-1",
    stage_id: "evm:1",
    version: 1,
    chain_family: "evm",
    chain_ref: "1",
    signer: sender,
    broadcaster: "wallet",
    state,
    transaction_id: state === "needs_signature" ? null : hash,
    failure_code: null,
    batch: null,
    wallet_attempt: null,
    action: null,
    review: {
      version: 1,
      revision: 1,
      digest: "payment-review",
      legs: [],
      request: {
        type: "execute_evm",
        transactions: [
          {
            chain_id: 1,
            from: sender,
            to: token,
            data,
            value: "0",
            label: "1500 USDC",
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
    },
  };
}
function receipt() {
  return {
    status: "0x1",
    transactionHash: hash,
    from: sender,
    to: token,
    blockNumber: "0x64",
    blockHash,
    logs: [
      {
        address: token,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: "Transfer",
          args: { from: sender, to: recipient },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [1_500_000_000n]),
      },
    ],
  };
}
function fixture(
  options: {
    balance?: bigint;
    gas?: bigint;
    chainId?: number;
    receipt?: ReturnType<typeof receipt> | null;
    delta?: bigint;
    canonicalHash?: string;
    decimals?: bigint;
    offline?: boolean;
  } = {},
) {
  const calls: { method: string; params: unknown[] }[] = [];
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (_url, init) => {
      if (options.offline) throw new Error("secret upstream error");
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      let result: unknown;
      switch (body.method) {
        case "eth_chainId":
          result = hex(BigInt(options.chainId ?? 1));
          break;
        case "eth_blockNumber":
          result = "0x64";
          break;
        case "eth_getBalance":
          result = hex(options.gas ?? 10n ** 18n);
          break;
        case "eth_gasPrice":
          result = hex(1_000_000_000n);
          break;
        case "eth_estimateGas":
          result = hex(65_000n);
          break;
        case "eth_getTransactionReceipt":
          result = "receipt" in options ? options.receipt : receipt();
          break;
        case "eth_getBlockByNumber":
          result = { hash: options.canonicalHash ?? blockHash };
          break;
        case "eth_call": {
          if (body.params[0].data === "0x313ce567")
            result = hex(options.decimals ?? 6n);
          else if (body.params[1] === "0x63") result = hex(5_000n);
          else
            result = hex(
              options.balance ?? 5_000n + (options.delta ?? 1_500_000_000n),
            );
          break;
        }
        default:
          throw new Error(`Non-read-only or unexpected method: ${body.method}`);
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    });
  return { payment: new EvmPayment(intent, { rpcUrl, fetch }), fetch, calls };
}

describe("operational payment funding", () => {
  it("checks known positions and selects funded ops rather than a treasury", async () => {
    const { payment, calls } = fixture();
    const report = await payment.preflight([
      source("treasury"),
      source("development"),
      source(),
    ]);
    expect(report.sources.map((row) => row.state)).toEqual([
      "not_operational",
      "not_operational",
      "funded",
    ]);
    expect(report.selected?.role).toBe("operational");
    expect(report.sources[2]).toMatchObject({
      balance: "1500.005",
      shortfall: "0",
      nativeGasBudget: "130000000000000",
    });
    expect(JSON.stringify(report)).not.toContain("private-rpc-key");
    expect(
      calls.filter((call) => call.method === "eth_estimateGas"),
    ).toHaveLength(1);
  });
  it("shows the exact shortfall rather than selecting the Safe", async () => {
    const { payment } = fixture({ balance: 1_000_000_000n });
    const report = await payment.preflight([source(), source("treasury")]);
    expect(report.selected).toBeNull();
    expect(report.sources[0]).toMatchObject({
      state: "insufficient_token",
      balance: "1000",
      shortfall: "500",
    });
  });
  it("checks native gas separately from the token balance", async () => {
    const { payment } = fixture({ gas: 0n });
    const report = await payment.preflight([source()]);
    expect(report.selected).toBeNull();
    expect(report.sources[0].state).toBe("insufficient_gas");
  });
  it("reports other-chain assets as needing a fresh route and unquoted fees", async () => {
    const { payment } = fixture({ chainId: 4663 });
    const report = await payment.preflight([
      { ...source(), asset: { ...asset, chainId: 4663, token: other } },
    ]);
    expect(report.selected).toBeNull();
    expect(report.routeFees).toBe("unquoted");
    expect(report.sources[0]).toMatchObject({
      state: "route_required",
      shortfall: null,
    });
  });
  it.each([{ chainId: 8453 }, { decimals: 18n }, { offline: true }])(
    "does not treat unavailable or wrong-chain evidence as funding",
    async (options) => {
      const { payment } = fixture(options);
      const report = await payment.preflight([source()]);
      expect(report.selected).toBeNull();
      expect(report.sources[0].state).toBe("unavailable");
      expect(JSON.stringify(report)).not.toContain("secret upstream");
    },
  );
  it.each(["0", "-1", "1500.0000001", "1e3"])(
    "rejects an inexact or invalid amount %s",
    (amount) => {
      expect(() => new EvmPayment({ ...intent, amount }, { rpcUrl })).toThrow();
    },
  );
});

describe("durable payment reconciliation", () => {
  it("offers a signature only for an exact unsigned, simulated Commit", async () => {
    const { payment, fetch } = fixture();
    const view = commit("needs_signature");
    view.action = {
      kind: "sign",
      payload: {
        kind: "evm_transaction",
        chain_id: 1,
        signer: sender,
        nonce: 0,
        transaction: {
          to: token,
          value: "0",
          data,
          gas_limit: 65000,
          max_fee_per_gas: "1000000000",
          max_priority_fee_per_gas: "0",
        },
      },
    };
    expect(await payment.status(view)).toMatchObject({
      phase: "awaiting_signature",
      canRequestSignature: true,
    });
    view.action.payload.transaction.to = other;
    expect(await payment.status(view)).toMatchObject({
      canRequestSignature: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not restart an outstanding wallet attempt even without a hash", async () => {
    const { payment } = fixture();
    const view = commit("needs_signature");
    view.wallet_attempt = {
      attempt_id: "attempt-1",
      transport: "browser_send",
      state: "observing",
      transaction_id: null,
      failure_code: null,
    };
    expect(await payment.status(view)).toMatchObject({
      canRequestSignature: false,
    });
  });
  it("requires the approved sender when reconciling a Commit", async () => {
    const { payment, fetch } = fixture();
    const view = commit();
    view.signer = other;
    view.review!.request.transactions[0].from = other;
    expect(await payment.status(view)).toMatchObject({
      phase: "verification_failed",
      canRequestSignature: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("ties receipt, exact Transfer and recipient delta to the same Commit", async () => {
    const { payment, calls } = fixture();
    const status = await payment.status(commit());
    expect(status).toMatchObject({
      commitId: "payment-1",
      transactionId: hash,
      phase: "payment_completed",
      receipt: "confirmed",
      recipient: "verified",
      balanceBefore: "0.005",
      balanceAfter: "1500.005",
      balanceDelta: "1500",
      canRequestSignature: false,
    });
    expect(
      calls
        .filter((call) => call.method === "eth_call")
        .map((call) => call.params[1]),
    ).toContain("0x63");
  });
  it("reconciles a persisted hash even when the restored Commit still says needs_signature", async () => {
    const { payment } = fixture();
    const restored = { ...commit("needs_signature"), transaction_id: hash };
    expect(
      await payment.status(JSON.parse(JSON.stringify(restored))),
    ).toMatchObject({ phase: "payment_completed", canRequestSignature: false });
  });
  it("keeps a pending transaction from opening another signing attempt", async () => {
    const { payment } = fixture({ receipt: null });
    expect(await payment.status(commit())).toMatchObject({
      phase: "submitted",
      receipt: "pending",
      canRequestSignature: false,
    });
  });
  it("does not call a successful receipt paid without the recipient delta", async () => {
    const { payment } = fixture({ delta: 0n });
    expect(await payment.status(commit())).toMatchObject({
      phase: "verification_pending",
      receipt: "confirmed",
      recipient: "unverified",
      balanceDelta: "0",
      canRequestSignature: false,
    });
  });
  it("reports a reverted receipt without suggesting another signature", async () => {
    const failed = receipt();
    failed.status = "0x0";
    const { payment } = fixture({ receipt: failed });
    expect(await payment.status(commit())).toMatchObject({
      phase: "failed",
      receipt: "reverted",
      canRequestSignature: false,
    });
  });
  it.each(["token", "sender", "amount"])(
    "rejects mismatched receipt evidence: %s",
    async (field) => {
      const wrong = receipt();
      if (field === "token") wrong.logs[0].address = other;
      if (field === "sender") wrong.from = other;
      if (field === "amount")
        wrong.logs[0].data = encodeAbiParameters([{ type: "uint256" }], [1n]);
      const { payment } = fixture({ receipt: wrong });
      expect(await payment.status(commit())).toMatchObject({
        phase: "verification_failed",
        recipient: "unverified",
        canRequestSignature: false,
      });
    },
  );
  it.each([{ chainId: 8453 }, { offline: true }, { canonicalHash: hash }])(
    "keeps unavailable/noncanonical evidence unverified: %j",
    async (options) => {
      const { payment } = fixture(options);
      expect(await payment.status(commit())).toMatchObject({
        phase: "verification_pending",
        recipient: "unverified",
        canRequestSignature: false,
      });
    },
  );
  it("binds the immutable approved intent to the exact reviewed calldata", async () => {
    const { payment, fetch } = fixture();
    const different = { ...commit(), chain_ref: "8453" };
    expect(await payment.status(different)).toMatchObject({
      phase: "verification_failed",
      canRequestSignature: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
