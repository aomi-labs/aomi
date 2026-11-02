import { describe, it, expect, vi } from "vitest";
import { getAddress } from "viem";
import {
  commitCapabilities,
  CommitController,
  isTerminalCommit,
  type CommitCapabilities,
  type CommitRecoveryRecord,
  type CommitRecoveryStore,
  type CommitView,
  type EvmCommitMessage,
} from "./commits";
import type { AomiClient } from "./client";
import { PartialWalletExecutionError } from "./aa/execute";
import { projectCommitLifecycle } from "./commit-lifecycle";

const unsigned: CommitView = {
  version: 1,
  commit_id: "cmt-one",
  thread_id: "thread",
  stage_id: "svm:1",
  chain_family: "svm",
  chain_ref: "localnet",
  signer: "payer",
  broadcaster: "wallet",
  state: "needs_signature",
  transaction_id: null,
  failure_code: null,
  batch: null,
  review: null,
  wallet_attempt: null,
  action: {
    kind: "sign",
    payload: {
      kind: "svm_transaction",
      signer: "payer",
      transaction_base64: "unsigned",
    },
  },
};
const signed: CommitView = {
  ...unsigned,
  version: 2,
  state: "awaiting_broadcast",
  action: {
    kind: "broadcast",
    signed_transaction: "exact-signed",
    transaction_id: "chain-sig",
  },
};
const submitted: CommitView = {
  ...signed,
  version: 3,
  state: "submitted",
  action: null,
  transaction_id: "chain-sig",
};

function recoveryStore() {
  const records = new Map<string, CommitRecoveryRecord>();
  const store: CommitRecoveryStore = {
    load: (_threadId, commitId) => records.get(commitId),
    save: (_threadId, commitId, record) => records.set(commitId, record),
    remove: (_threadId, commitId) => records.delete(commitId),
  };
  return { records, store };
}

const externalPayload = {
  kind: "evm_transaction" as const,
  chain_id: 8453,
  signer: "0x1111111111111111111111111111111111111111",
  nonce: 7,
  transaction: {
    to: "0x2222222222222222222222222222222222222222",
    value: "0",
    data: "0x1234",
    gas_limit: 25_000,
    max_fee_per_gas: "30",
    max_priority_fee_per_gas: "2",
  },
};
const external: CommitView = {
  ...unsigned,
  chain_family: "evm",
  chain_ref: "8453",
  signer: "0x1111111111111111111111111111111111111111",
  supported_transports: ["sign_and_broadcast", "browser_send"],
  review: {
    version: 1,
    revision: 1,
    digest: "review-digest",
    request: {
      type: "execute_evm",
      transactions: [],
      simulation: {
        status: "passed",
        balanceChanges: [],
        approvals: [],
        fees: [],
        gas: null,
        guards: [],
        logs: [],
        warnings: [],
      },
    },
    legs: [],
  },
  action: {
    kind: "sign",
    payload: externalPayload,
  },
};
const historicalExternal: CommitView = {
  ...external,
  supported_transports: undefined,
  action: {
    kind: "start_wallet_send",
    review_digest: "review-digest",
    payload: externalPayload,
  },
};

describe("Commit view surfaces", () => {
  it("merges newer callback delivery without changing equal-version chain or review data", () => {
    const controller = new CommitController({} as AomiClient, "thread");
    const pending: CommitView = {
      ...submitted,
      state: "confirmed",
      continuation: {
        version: 1,
        revision: 1,
        state: "pending",
        attempts: 0,
      },
    };
    controller.ingest(pending);
    controller.ingest({
      ...pending,
      state: "failed",
      failure_code: "stale-chain",
      continuation: {
        version: 1,
        revision: 2,
        state: "completed",
        attempts: 1,
      },
    });
    expect(controller.all()[0]).toEqual({
      ...pending,
      continuation: {
        version: 1,
        revision: 2,
        state: "completed",
        attempts: 1,
      },
    });
    controller.ingest(pending);
    controller.ingest({ ...pending, continuation: undefined });
    expect(controller.all()[0].continuation?.state).toBe("completed");
    controller.close();
  });

  it("keeps a newer continuation through a delayed refresh and a newer chain version", async () => {
    const current: CommitView = {
      ...submitted,
      state: "confirmed",
      continuation: {
        version: 1,
        revision: 3,
        state: "completed",
        attempts: 1,
      },
    };
    const stale = {
      ...current,
      version: current.version + 1,
      continuation: {
        version: 1 as const,
        revision: 2,
        state: "retrying" as const,
        attempts: 1,
      },
    };
    const controller = new CommitController(
      { request: vi.fn(async () => stale) } as unknown as AomiClient,
      "thread",
    );
    controller.ingest(current);
    const refreshed = await controller.refresh(current.commit_id);
    expect(refreshed.version).toBe(stale.version);
    expect(refreshed.continuation).toEqual(current.continuation);
    controller.close();
  });

  it("keeps stamped metadata immutable at its revision and accepts an initial revision zero", async () => {
    const stamped: CommitView = {
      ...submitted,
      state: "confirmed",
      continuation: {
        version: 1,
        revision: 0,
        state: "completed",
        attempts: 1,
      },
    };
    const response: CommitView = {
      ...stamped,
      version: 4,
      continuation: {
        version: 1,
        revision: 0,
        state: "pending",
        attempts: 0,
      },
    };
    const controller = new CommitController(
      { request: vi.fn(async () => response) } as unknown as AomiClient,
      "thread",
    );
    try {
      controller.ingest(stamped);
      expect(
        (await controller.refresh(stamped.commit_id)).continuation,
      ).toEqual(stamped.continuation);
      controller.ingest({ ...submitted, commit_id: "initial" });
      controller.ingest({
        ...stamped,
        commit_id: "initial",
        version: 4,
        continuation: {
          version: 1,
          revision: 0,
          state: "pending",
          attempts: 0,
        },
      });
      expect(
        controller.all().find((view) => view.commit_id === "initial")
          ?.continuation,
      ).toMatchObject({ revision: 0, state: "pending" });
    } finally {
      controller.close();
    }
  });

  it("merges both axes independently, including absent metadata and other commit identities", () => {
    const controller = new CommitController({} as AomiClient, "thread");
    const current: CommitView = {
      ...submitted,
      continuation: {
        version: 1,
        revision: 3,
        state: "completed",
        attempts: 1,
      },
    };
    controller.ingest(current);
    controller.ingest({
      ...current,
      version: 4,
      state: "confirmed",
      transaction_id: "final-hash",
      continuation: { version: 1, revision: 2, state: "retrying", attempts: 1 },
    });
    expect(controller.all()[0]).toMatchObject({
      version: 4,
      state: "confirmed",
      transaction_id: "final-hash",
      continuation: { revision: 3, state: "completed" },
    });
    controller.ingest({
      ...current,
      version: 2,
      state: "needs_signature",
      continuation: {
        version: 1,
        revision: 4,
        state: "assistant_recovery_required",
        attempts: 2,
      },
    });
    expect(controller.all()[0]).toMatchObject({
      version: 4,
      state: "confirmed",
      transaction_id: "final-hash",
      continuation: { revision: 4, state: "assistant_recovery_required" },
    });
    controller.ingest({
      ...current,
      version: 5,
      state: "confirmed",
      continuation: undefined,
    });
    expect(controller.all()[0]).toMatchObject({
      version: 5,
      continuation: { revision: 4 },
    });
    controller.ingest({
      ...current,
      commit_id: "another",
      state: "confirmed",
      continuation: { version: 1, revision: 0, state: "pending", attempts: 0 },
    });
    expect(
      controller.all().find((view) => view.commit_id === "another")
        ?.continuation,
    ).toMatchObject({ revision: 0, state: "pending" });
    controller.close();
  });

  it("polls terminal commits while callback delivery is pending and stops when completed", async () => {
    vi.useFakeTimers();
    const pending: CommitView = {
      ...submitted,
      state: "confirmed",
      continuation: {
        version: 1,
        revision: 0,
        state: "pending",
        attempts: 0,
      },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({
        ...pending,
        continuation: {
          version: 1,
          revision: 1,
          state: "completed",
          attempts: 1,
        },
      });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
    );
    try {
      await controller.refresh(pending.commit_id);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(controller.all()[0].continuation?.state).toBe("completed");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      controller.close();
      vi.useRealTimers();
    }
  });

  it("waits for every commit in a polling round before starting another", async () => {
    vi.useFakeTimers();
    const pending: CommitView = {
      ...submitted,
      state: "confirmed",
      continuation: { version: 1, revision: 0, state: "pending", attempts: 0 },
    };
    const slow = { ...pending, commit_id: "slow" };
    let releaseSlow!: (view: CommitView) => void;
    let slowRequests = 0;
    const request = vi.fn(async (_method: string, path: string) => {
      if (!path.includes("slow")) return pending;
      slowRequests++;
      if (slowRequests === 1)
        return new Promise<CommitView>((resolve) => {
          releaseSlow = resolve;
        });
      return slow;
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
    );
    try {
      controller.ingest(pending);
      controller.ingest(slow);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(request).toHaveBeenCalledTimes(2);
      expect(slowRequests).toBe(1);

      releaseSlow(slow);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(request).toHaveBeenCalledTimes(4);
      expect(slowRequests).toBe(2);
    } finally {
      controller.close();
      vi.useRealTimers();
    }
  });

  it.each(["completed", "assistant_recovery_required", "exhausted"] as const)(
    "does not poll settled callback state %s or legacy terminal views",
    async (state) => {
      vi.useFakeTimers();
      const request = vi.fn();
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        "thread",
      );
      try {
        controller.ingest({ ...submitted, state: "confirmed" });
        controller.ingest({
          ...submitted,
          version: submitted.version + 1,
          state: "confirmed",
          continuation: { version: 1, revision: 2, state, attempts: 1 },
        });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(request).not.toHaveBeenCalled();
      } finally {
        controller.close();
        vi.useRealTimers();
      }
    },
  );

  it("reports preparation before a provider prompt and clears the local phase after submission", async () => {
    const recovery = recoveryStore();
    let releaseWallet!: (hash: string) => void;
    const walletResponse = new Promise<string>((resolve) => {
      releaseWallet = resolve;
    });
    let latePhase:
      | ((phase: "switching_chain" | "awaiting_wallet" | "submitting") => void)
      | undefined;
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return external;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      return { ...external, version: 2, state: "submitted" };
    });
    const walletSend: NonNullable<CommitCapabilities["walletSend"]> = vi.fn(
      async (_view, _payload, onPhase) => {
        latePhase = onPhase;
        onPhase?.("switching_chain");
        expect(controller.submissionPhase(external.commit_id)).toBe(
          "switching_chain",
        );
        onPhase?.("awaiting_wallet");
        return walletResponse;
      },
    );
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
    );
    controller.subscribe(() => {
      if (controller.submissionPhase(external.commit_id) === "awaiting_wallet")
        throw new Error("broken presentation observer");
    });
    const execution = controller.execute(external.commit_id);
    expect(controller.submissionPhase(external.commit_id)).toBe("preparing");
    await vi.waitFor(() =>
      expect(controller.submissionPhase(external.commit_id)).toBe(
        "awaiting_wallet",
      ),
    );
    releaseWallet("0xhash");
    await execution;
    expect(controller.submissionPhase(external.commit_id)).toBeUndefined();
    latePhase?.("awaiting_wallet");
    expect(controller.submissionPhase(external.commit_id)).toBeUndefined();
  });

  it("refuses a new attempt when the reviewed guard explicitly blocked execution", async () => {
    const reviewed = external.review!.request;
    if (reviewed.type !== "execute_evm") throw new Error("fixture changed");
    const blocked: CommitView = {
      ...external,
      review: {
        ...external.review!,
        request: {
          ...reviewed,
          transactions: [
            {
              chain_id: 8453,
              from: external.signer,
              to: externalPayload.transaction.to,
              data: externalPayload.transaction.data,
              label: "Reviewed transaction",
              kind: "withdraw",
            },
          ],
          simulation: {
            ...reviewed.simulation,
            status: "passed",
            guards: [
              { name: "eligibility", status: "failed", message: "Blocked" },
            ],
          },
        },
      },
    };
    const request = vi.fn(async () => blocked);
    const walletSend = vi.fn();
    const recovery = recoveryStore();
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      blocked.thread_id,
      {
        walletSend,
        walletSendPreflight: vi.fn(),
        recovery: recovery.store,
      },
    );
    await expect(controller.execute(blocked.commit_id)).rejects.toThrow(
      "Execution is blocked",
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(walletSend).not.toHaveBeenCalled();
    recovery.records.set(blocked.commit_id, {
      clientRequestId: "saved-before-post",
    });
    await expect(controller.execute(blocked.commit_id)).rejects.toThrow(
      "Execution is blocked",
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.canExecute(blocked)).toBe(false);
    recovery.records.set(blocked.commit_id, {
      clientRequestId: "existing-request",
      attemptId: "existing-attempt",
      transactionId: "0xexisting",
    });
    expect(controller.canExecute(blocked)).toBe(true);
    controller.close();
  });

  it("advertises only wallet operations available for the commit chain", () => {
    const empty = new CommitController(
      { request: vi.fn() } as unknown as AomiClient,
      unsigned.thread_id,
      commitCapabilities({}),
    );
    expect(empty.canExecute(unsigned)).toBe(false);
    expect(empty.canExecute(signed)).toBe(false);
    empty.close();

    const evmOnly = new CommitController(
      { request: vi.fn() } as unknown as AomiClient,
      unsigned.thread_id,
      commitCapabilities({
        evm: {
          address: external.signer,
          signTransaction: vi.fn(),
          broadcastTransaction: vi.fn(),
        },
      }),
    );
    expect(evmOnly.canExecute(unsigned)).toBe(false);
    expect(evmOnly.canExecute(external)).toBe(true);
    expect(evmOnly.canExecute(signed)).toBe(false);
    expect(
      evmOnly.canExecute({
        ...external,
        action: {
          kind: "sign",
          payload: {
            ...externalPayload,
            signer: "0x3333333333333333333333333333333333333333",
          },
        },
      }),
    ).toBe(false);
    expect(
      evmOnly.canExecute({
        ...external,
        action: {
          kind: "sign",
          payload: { ...externalPayload, chain_id: 1 },
        },
      }),
    ).toBe(false);
    evmOnly.close();

    const wrongWallet = new CommitController(
      { request: vi.fn() } as unknown as AomiClient,
      external.thread_id,
      commitCapabilities(
        {
          evm: {
            address: "0x3333333333333333333333333333333333333333",
            preparePreparedTransaction: vi.fn(),
            sendPreparedTransaction: vi.fn(),
          },
        },
        recoveryStore().store,
      ),
    );
    expect(wrongWallet.canExecute(external)).toBe(false);
    wrongWallet.close();
  });

  it("does not use a wallet when the reviewed commit changed before execution", async () => {
    const signTransaction = vi.fn();
    const refreshed = {
      ...external,
      version: 2,
      review: { ...external.review!, digest: "new-digest" },
    };
    const request = vi.fn().mockResolvedValue(refreshed);
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      commitCapabilities({
        evm: { address: external.signer, signTransaction },
      }),
    );
    await expect(
      controller.execute(external.commit_id, {
        expectedVersion: external.version,
        expectedReviewDigest: external.review!.digest,
      }),
    ).rejects.toThrow("Commit review changed; refresh and review it again");
    expect(signTransaction).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("requires the durable review digest before executing a reviewed version", async () => {
    const signTransaction = vi.fn();
    const request = vi.fn().mockResolvedValue(external);
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      commitCapabilities({
        evm: { address: external.signer, signTransaction },
      }),
    );
    await expect(
      controller.execute(external.commit_id, {
        expectedVersion: external.version,
      }),
    ).rejects.toThrow("Commit review digest is required for execution");
    expect(signTransaction).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.submissionPhase(external.commit_id)).toBeUndefined();
    controller.close();
  });

  it("rejects a mismatched prepared payload before invoking the wallet", async () => {
    const signTransaction = vi.fn();
    const mismatched = {
      ...external,
      action: {
        kind: "sign" as const,
        payload: {
          ...externalPayload,
          signer: "0x3333333333333333333333333333333333333333",
        },
      },
    };
    const controller = new CommitController(
      {
        request: vi.fn().mockResolvedValue(mismatched),
      } as unknown as AomiClient,
      external.thread_id,
      commitCapabilities({
        evm: { address: external.signer, signTransaction },
      }),
    );
    await expect(controller.execute(external.commit_id)).rejects.toThrow(
      "Prepared commit payload does not match its signer or chain",
    );
    expect(signTransaction).not.toHaveBeenCalled();
    controller.close();
  });

  it("accepts external signatures only for the reviewed version and sign action", async () => {
    const request = vi.fn(
      async (method: string, _path: string, options?: { body?: unknown }) => {
        if (method === "GET") return unsigned;
        expect(options?.body).toEqual({
          kind: "signed",
          payloads: ["signed-by-external-wallet"],
        });
        return signed;
      },
    );
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      unsigned.thread_id,
    );
    await expect(
      controller.submitSigned(
        unsigned.commit_id,
        ["signed-by-external-wallet"],
        {
          expectedVersion: unsigned.version,
        },
      ),
    ).resolves.toMatchObject({ state: "awaiting_broadcast" });
    expect(request).toHaveBeenCalledTimes(2);
    await expect(
      controller.submitSigned(
        unsigned.commit_id,
        ["signed-by-external-wallet"],
        {
          expectedVersion: unsigned.version,
        },
      ),
    ).rejects.toThrow("Commit review changed; refresh and review it again");
    expect(request).toHaveBeenCalledTimes(3);
    controller.close();
  });

  it("requires the durable digest when externally submitting a reviewed commit", async () => {
    const request = vi.fn().mockResolvedValue(external);
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
    );
    await expect(
      controller.submitSigned(
        external.commit_id,
        ["signed-by-external-wallet"],
        {
          expectedVersion: external.version,
        },
      ),
    ).rejects.toThrow(
      "Commit review digest is required for external submission",
    );
    expect(request).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("accepts an external broadcast report only for the prepared transaction", async () => {
    const request = vi.fn(
      async (method: string, _path: string, options?: { body?: unknown }) => {
        if (method === "GET") return signed;
        expect(options?.body).toEqual({
          kind: "broadcast",
          transaction_id: "chain-sig",
        });
        return submitted;
      },
    );
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      signed.thread_id,
    );
    await expect(
      controller.submitBroadcast(signed.commit_id, "wrong-hash", {
        expectedVersion: signed.version,
      }),
    ).rejects.toThrow(
      "Broadcast transaction does not match the reviewed commit",
    );
    await expect(
      controller.submitBroadcast(signed.commit_id, "chain-sig", {
        expectedVersion: signed.version,
      }),
    ).resolves.toMatchObject({ state: "submitted" });
    expect(request).toHaveBeenCalledTimes(3);
    controller.close();
  });

  it.each(["submitted", "confirmed"] as const)(
    "treats an already %s matching broadcast as an idempotent report",
    async (state) => {
      const observed = {
        ...submitted,
        state,
        version: state === "confirmed" ? 4 : submitted.version,
      };
      const request = vi.fn().mockResolvedValue(observed);
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        observed.thread_id,
      );
      await expect(
        controller.submitBroadcast(observed.commit_id, "chain-sig", {
          expectedVersion: signed.version,
        }),
      ).resolves.toMatchObject({ state });
      expect(request).toHaveBeenCalledTimes(1);
      await expect(
        controller.submitBroadcast(observed.commit_id, "wrong-hash", {
          expectedVersion: signed.version,
        }),
      ).rejects.toThrow(
        "Broadcast transaction does not match the reviewed commit",
      );
      expect(request).toHaveBeenCalledTimes(2);
      controller.close();
    },
  );

  it.each(["refresh", "preflight", "attempt"] as const)(
    "does not invoke a wallet when the session closes during %s",
    async (stage) => {
      const recovery = recoveryStore();
      const walletSend = vi.fn();
      const walletSendPreflight = vi.fn(async () => {
        if (stage === "preflight") controller.close();
      });
      const request = vi.fn(async (method: string) => {
        if (method === "GET") {
          if (stage === "refresh") controller.close();
          return external;
        }
        if (stage === "attempt") controller.close();
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      });
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        external.thread_id,
        { walletSend, walletSendPreflight, recovery: recovery.store },
      );

      await expect(controller.execute(external.commit_id)).rejects.toThrow(
        "Commit session closed",
      );
      expect(walletSend).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(stage === "attempt" ? 2 : 1);
      if (stage === "attempt") {
        expect(recovery.records.get(external.commit_id)).toMatchObject({
          attemptId: "attempt-1",
        });
      } else {
        expect(recovery.records.size).toBe(0);
      }
    },
  );

  it("persists a wallet-returned hash before reporting it", async () => {
    const recovery = recoveryStore();
    const walletSend = vi.fn().mockResolvedValue("0xhash");
    let reportSawPersistedHash = false;
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return external;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      reportSawPersistedHash =
        recovery.records.get(external.commit_id)?.transactionId === "0xhash";
      return {
        ...external,
        version: 2,
        state: "submitted",
        action: null,
        transaction_id: "0xhash",
        wallet_attempt: {
          attempt_id: "attempt-1",
          transport: "browser_send",
          state: "observing",
          transaction_id: "0xhash",
          failure_code: null,
        },
      } satisfies CommitView;
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
    );
    await expect(controller.execute(external.commit_id)).resolves.toMatchObject(
      {
        state: "submitted",
        transaction_id: "0xhash",
      },
    );
    expect(reportSawPersistedHash).toBe(true);
    expect(walletSend).toHaveBeenCalledTimes(1);
    expect(recovery.records.has(external.commit_id)).toBe(false);
    controller.close();
  });

  describe("on-chain receipt (display only)", () => {
    const reported: CommitView = {
      ...external,
      version: 2,
      state: "submitted",
      action: null,
      transaction_id: "0xhash",
      wallet_attempt: {
        attempt_id: "attempt-1",
        transport: "browser_send",
        state: "observing",
        transaction_id: "0xhash",
        failure_code: null,
      },
    };
    function setup(walletReceipt: CommitCapabilities["walletReceipt"]) {
      const recovery = recoveryStore();
      const request = vi.fn(async (method: string, path: string) => {
        if (method === "GET") return external;
        if (path.endsWith("/wallet-attempts"))
          return {
            attempt_id: "attempt-1",
            transport: "browser_send",
            commit_id: external.commit_id,
            state: "awaiting_wallet",
            request: externalPayload,
            may_invoke_wallet: true,
          };
        return reported;
      });
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        external.thread_id,
        {
          walletSend: vi.fn().mockResolvedValue("0xhash"),
          walletSendPreflight: vi.fn(),
          walletReceipt,
          recovery: recovery.store,
        },
      );
      return { controller, request };
    }
    const label = (controller: CommitController) =>
      projectCommitLifecycle(
        controller.all()[0]!,
        undefined,
        undefined,
        controller.onChainOutcome(external.commit_id),
      );

    it("shows a successful receipt as confirmed on chain without telling the backend", async () => {
      const { controller, request } = setup(
        vi.fn().mockResolvedValue("success"),
      );
      await controller.execute(external.commit_id);
      await vi.waitFor(() =>
        expect(controller.onChainOutcome(external.commit_id)).toBe("success"),
      );
      expect(label(controller)).toMatchObject({
        phase: "submitted",
        label: "Confirmed on chain",
        onChain: "success",
      });
      // GET, create attempt, report: the receipt added no request.
      expect(request).toHaveBeenCalledTimes(3);
      controller.close();
    });

    it("shows a reverted receipt as failed on chain", async () => {
      const { controller } = setup(vi.fn().mockResolvedValue("reverted"));
      await controller.execute(external.commit_id);
      await vi.waitFor(() =>
        expect(controller.onChainOutcome(external.commit_id)).toBe("reverted"),
      );
      expect(label(controller)).toMatchObject({ label: "Failed on chain" });
      controller.close();
    });

    it("drops the provisional label and ignores a late receipt when Commit Service settles", async () => {
      let release!: (outcome: "success") => void;
      const { controller } = setup(
        () => new Promise((resolve) => (release = resolve)),
      );
      await controller.execute(external.commit_id);
      controller.ingest({
        ...reported,
        version: 3,
        state: "failed",
        failure_code: "reverted",
      });
      release("success");
      await Promise.resolve();
      await Promise.resolve();
      expect(controller.onChainOutcome(external.commit_id)).toBeUndefined();
      expect(label(controller)).toMatchObject({ phase: "failed" });
      controller.close();
    });

    it("clears a shown label when Commit Service reports a mismatch", async () => {
      const { controller } = setup(vi.fn().mockResolvedValue("success"));
      await controller.execute(external.commit_id);
      await vi.waitFor(() =>
        expect(controller.onChainOutcome(external.commit_id)).toBe("success"),
      );
      controller.ingest({
        ...reported,
        version: 3,
        wallet_attempt: { ...reported.wallet_attempt!, state: "mismatched" },
      });
      expect(controller.onChainOutcome(external.commit_id)).toBeUndefined();
      controller.close();
    });

    it("stops waiting after two minutes and on close", async () => {
      vi.useFakeTimers();
      try {
        let release!: (outcome: "success") => void;
        const { controller } = setup(
          () => new Promise((resolve) => (release = resolve)),
        );
        await controller.execute(external.commit_id);
        await vi.advanceTimersByTimeAsync(120_000);
        release("success");
        await vi.advanceTimersByTimeAsync(0);
        expect(controller.onChainOutcome(external.commit_id)).toBeUndefined();
        controller.close();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("retries only the saved hash after a lost report response", async () => {
    const recovery = recoveryStore();
    const walletSend = vi.fn().mockResolvedValue("0xhash");
    const walletSendPreflight = vi.fn();
    let reports = 0;
    const awaiting: CommitView = {
      ...external,
      action: null,
      wallet_attempt: {
        attempt_id: "attempt-1",
        transport: "browser_send",
        state: "awaiting_wallet",
        transaction_id: null,
        failure_code: null,
      },
    };
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return reports ? awaiting : external;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      reports += 1;
      if (reports === 1) throw new Error("lost report response");
      return {
        ...submitted,
        commit_id: external.commit_id,
        thread_id: external.thread_id,
        chain_family: "evm",
        chain_ref: "8453",
        signer: external.signer,
        transaction_id: "0xhash",
      } satisfies CommitView;
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight, recovery: recovery.store },
    );
    await expect(controller.execute(external.commit_id)).rejects.toThrow(
      "lost report response",
    );
    expect(controller.canExecute(awaiting)).toBe(true);
    await expect(controller.execute(external.commit_id)).resolves.toMatchObject(
      {
        state: "submitted",
      },
    );
    expect(walletSend).toHaveBeenCalledTimes(1);
    expect(walletSendPreflight).toHaveBeenCalledTimes(1);
    expect(reports).toBe(2);
    controller.close();
  });

  it("does not reinterpret a report failure as a wallet rejection", async () => {
    const recovery = recoveryStore();
    const walletSend = vi.fn().mockResolvedValue("0xhash");
    const request = vi.fn(async (method: string, path: string, options) => {
      if (method === "GET") return external;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      expect(options.body).toEqual({
        kind: "transaction",
        transaction_id: "0xhash",
      });
      throw { code: 4001 };
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
    );
    await expect(controller.execute(external.commit_id)).rejects.toEqual({
      code: 4001,
    });
    expect(recovery.records.get(external.commit_id)).toMatchObject({
      attemptId: "attempt-1",
      transactionId: "0xhash",
    });
    controller.close();
  });

  it("does not invoke the wallet again after an ambiguous send error", async () => {
    const recovery = recoveryStore();
    const walletSend = vi.fn().mockRejectedValue(new Error("provider offline"));
    const awaiting: CommitView = {
      ...external,
      action: null,
      wallet_attempt: {
        attempt_id: "attempt-1",
        transport: "browser_send",
        state: "awaiting_wallet",
        transaction_id: null,
        failure_code: null,
      },
    };
    let gets = 0;
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return gets++ === 0 ? external : awaiting;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      throw new Error("unexpected report");
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
    );
    await expect(controller.execute(external.commit_id)).rejects.toThrow(
      "provider offline",
    );
    await expect(controller.execute(external.commit_id)).resolves.toBe(
      awaiting,
    );
    expect(walletSend).toHaveBeenCalledTimes(1);
    expect(controller.canExecute(awaiting)).toBe(false);
    controller.close();
  });

  it.each([
    [false, "switching_chain", "chain_switch", 4001],
    [true, "awaiting_wallet", "transaction_request", 4001],
    [false, "awaiting_wallet", "transaction_request", "4001"],
  ] as const)(
    "reports a %s wrapped provider rejection during %s with phase %s and code %s",
    async (wrapped, submissionPhase, rejectionPhase, providerCode) => {
      const recovery = recoveryStore();
      const rejected = { code: providerCode };
      const walletSend: NonNullable<CommitCapabilities["walletSend"]> = vi.fn(
        async (_commit, _payload, onPhase) => {
          onPhase?.(submissionPhase);
          throw wrapped
            ? new Error("Wallet request failed", { cause: rejected })
            : rejected;
        },
      );
      const request = vi.fn(async (method: string, path: string, options) => {
        if (method === "GET") return external;
        if (path.endsWith("/wallet-attempts"))
          return {
            attempt_id: "attempt-1",
            transport: "browser_send",
            commit_id: external.commit_id,
            state: "awaiting_wallet",
            request: externalPayload,
            may_invoke_wallet: true,
          };
        expect(options.body).toEqual({
          kind: "rejected",
          phase: rejectionPhase,
          provider_code: "4001",
          reason_category: "user_rejected",
        });
        return { ...external, version: 2, state: "rejected", action: null };
      });
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        external.thread_id,
        { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
      );
      await expect(
        controller.execute(external.commit_id),
      ).resolves.toMatchObject({
        state: "rejected",
      });
      expect(walletSend).toHaveBeenCalledTimes(1);
      controller.close();
    },
  );

  it("replays the same rejection diagnostics after a lost report response", async () => {
    const recovery = recoveryStore();
    const rejected = { code: 4001 };
    const walletSend: NonNullable<CommitCapabilities["walletSend"]> = vi.fn(
      async (_commit, _payload, onPhase) => {
        onPhase?.("awaiting_wallet");
        throw rejected;
      },
    );
    const awaiting: CommitView = {
      ...external,
      action: null,
      wallet_attempt: {
        attempt_id: "attempt-1",
        transport: "browser_send",
        state: "awaiting_wallet",
        transaction_id: null,
        failure_code: null,
      },
    };
    let reports = 0;
    const request = vi.fn(async (method: string, path: string, options) => {
      if (method === "GET") return reports ? awaiting : external;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      expect(options.body).toEqual({
        kind: "rejected",
        phase: "transaction_request",
        provider_code: "4001",
        reason_category: "user_rejected",
      });
      reports += 1;
      if (reports === 1) throw new Error("lost report response");
      return { ...awaiting, state: "rejected", wallet_attempt: null };
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
    );
    await expect(controller.execute(external.commit_id)).rejects.toThrow(
      "lost report response",
    );
    expect(recovery.records.get(external.commit_id)?.rejection).toEqual({
      kind: "rejected",
      phase: "transaction_request",
      provider_code: "4001",
      reason_category: "user_rejected",
    });
    await expect(controller.execute(external.commit_id)).resolves.toMatchObject(
      {
        state: "rejected",
      },
    );
    expect(reports).toBe(2);
    expect(walletSend).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("omits every rejection diagnostic when the adapter never reports a phase", async () => {
    const recovery = recoveryStore();
    const walletSend = vi.fn().mockRejectedValue({ code: 4001 });
    const awaiting: CommitView = {
      ...external,
      action: null,
      wallet_attempt: {
        attempt_id: "attempt-1",
        transport: "browser_send",
        state: "awaiting_wallet",
        transaction_id: null,
        failure_code: null,
      },
    };
    const bodies: unknown[] = [];
    const request = vi.fn(async (method: string, path: string, options) => {
      if (method === "GET") return bodies.length ? awaiting : external;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      bodies.push(options.body);
      if (bodies.length === 1) throw new Error("lost report response");
      return { ...awaiting, state: "rejected", wallet_attempt: null };
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
    );
    await expect(controller.execute(external.commit_id)).rejects.toThrow(
      "lost report response",
    );
    await expect(controller.execute(external.commit_id)).resolves.toMatchObject(
      { state: "rejected" },
    );
    expect(bodies).toEqual([{ kind: "rejected" }, { kind: "rejected" }]);
    expect(walletSend).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("heals a saved rejection with partial diagnostics before replaying it", async () => {
    const recovery = recoveryStore();
    recovery.records.set(external.commit_id, {
      clientRequestId: "request-1",
      attemptId: "attempt-1",
      rejected: true,
      rejection: {
        kind: "rejected",
        provider_code: "4001",
        reason_category: "user_rejected",
      },
    });
    const awaiting: CommitView = {
      ...external,
      action: null,
      wallet_attempt: {
        attempt_id: "attempt-1",
        transport: "browser_send",
        state: "awaiting_wallet",
        transaction_id: null,
        failure_code: null,
      },
    };
    const request = vi.fn(async (method: string, _path: string, options) => {
      if (method === "GET") return awaiting;
      expect(options.body).toEqual({ kind: "rejected" });
      return { ...awaiting, state: "rejected", wallet_attempt: null };
    });
    const walletSend = vi.fn();
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
    );
    await expect(controller.execute(external.commit_id)).resolves.toMatchObject(
      { state: "rejected" },
    );
    expect(walletSend).not.toHaveBeenCalled();
    expect(recovery.records.has(external.commit_id)).toBe(false);
    controller.close();
  });

  it.each([
    ["HTTP 422: Unprocessable Entity", false],
    ["HTTP 408: Request Timeout", true],
    ["network unavailable", true],
  ] as const)(
    "keeps the saved request ID after attempt failure %s: %s",
    async (message, kept) => {
      const recovery = recoveryStore();
      const request = vi.fn(async (method: string) => {
        if (method === "GET") return external;
        throw new Error(message);
      });
      const walletSend = vi.fn();
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        external.thread_id,
        { walletSend, walletSendPreflight: vi.fn(), recovery: recovery.store },
      );
      await expect(controller.execute(external.commit_id)).rejects.toThrow(
        message,
      );
      expect(recovery.records.has(external.commit_id)).toBe(kept);
      expect(walletSend).not.toHaveBeenCalled();
      controller.close();
    },
  );

  it.each([
    "Connect the expected signing wallet",
    "EVM wallet cannot switch to chain 8453",
  ])(
    "does not acquire an attempt when readiness fails: %s",
    async (message) => {
      const recovery = recoveryStore();
      const sign = vi.fn();
      const walletSend = vi.fn();
      const walletSendPreflight = vi.fn().mockRejectedValue(new Error(message));
      const request = vi.fn(async () => external);
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        external.thread_id,
        { sign, walletSend, walletSendPreflight, recovery: recovery.store },
      );

      await expect(controller.execute(external.commit_id)).rejects.toThrow(
        message,
      );

      expect(
        request.mock.calls.filter(
          ([method, path]) =>
            method === "POST" && String(path).endsWith("/wallet-attempts"),
        ),
      ).toHaveLength(0);
      expect(walletSend).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(recovery.records.size).toBe(0);
      controller.close();
    },
  );

  it("rejects malformed wallet targets before attempt creation or provider invocation", async () => {
    const recovery = recoveryStore();
    const sendPreparedTransaction = vi.fn();
    const preparePreparedTransaction = vi.fn();
    const malformed: CommitView = {
      ...external,
      action: {
        kind: "sign",
        payload: {
          ...externalPayload,
          transaction: { ...externalPayload.transaction, to: "0x1234" },
        },
      },
    };
    const request = vi.fn(async (_method: string) => malformed);
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      malformed.thread_id,
      {
        ...commitCapabilities({
          evm: {
            address: externalPayload.signer,
            preparePreparedTransaction,
            sendPreparedTransaction,
          },
        }),
        recovery: recovery.store,
      },
    );

    await expect(controller.execute(malformed.commit_id)).rejects.toThrow();
    expect(
      request.mock.calls.filter(([method]) => method === "POST"),
    ).toHaveLength(0);
    expect(sendPreparedTransaction).not.toHaveBeenCalled();
    expect(preparePreparedTransaction).not.toHaveBeenCalled();
    expect(recovery.records.size).toBe(0);
    controller.close();
  });

  it("selects advertised browser send only after readiness succeeds", async () => {
    const recovery = recoveryStore();
    const order: string[] = [];
    const sign = vi.fn();
    const walletSendPreflight = vi.fn(async () => {
      order.push("preflight");
    });
    const walletSend = vi.fn().mockResolvedValue("0xhash");
    const request = vi.fn(async (method: string, path: string, options) => {
      if (method === "GET") return external;
      if (path.endsWith("/wallet-attempts")) {
        order.push("attempt");
        expect(options.body).toMatchObject({
          review_digest: "review-digest",
          transport: "browser_send",
        });
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: external.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      }
      return {
        ...external,
        version: 2,
        state: "submitted",
        action: null,
        transaction_id: "0xhash",
      } satisfies CommitView;
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      {
        sign,
        walletSend,
        walletSendPreflight,
        recovery: recovery.store,
      },
    );

    await controller.execute(external.commit_id);

    expect(order).toEqual(["preflight", "attempt"]);
    expect(sign).not.toHaveBeenCalled();
    expect(walletSend).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("executes deprecated start-wallet-send views during a rolling upgrade", async () => {
    const recovery = recoveryStore();
    const walletSend = vi.fn().mockResolvedValue("0xhash");
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return historicalExternal;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: historicalExternal.commit_id,
          state: "awaiting_wallet",
          request: externalPayload,
          may_invoke_wallet: true,
        };
      return {
        ...historicalExternal,
        version: 2,
        state: "submitted",
        action: null,
        transaction_id: "0xhash",
      } satisfies CommitView;
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      historicalExternal.thread_id,
      {
        walletSend,
        walletSendPreflight: vi.fn(),
        recovery: recovery.store,
      },
    );

    expect(controller.canExecute(historicalExternal)).toBe(true);
    await controller.execute(historicalExternal.commit_id);

    expect(walletSend).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("keeps advertised commits on sign and broadcast for legacy consumers", async () => {
    const sign = vi.fn().mockResolvedValue(["signed-bytes"]);
    const request = vi.fn(async (method: string, _path: string, options) => {
      if (method === "GET") return external;
      expect(options.body).toEqual({
        kind: "signed",
        payloads: ["signed-bytes"],
      });
      return {
        ...external,
        version: 2,
        state: "submitted",
        action: null,
      } satisfies CommitView;
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      { sign },
    );

    expect(controller.canExecute(external)).toBe(true);
    await controller.execute(external.commit_id);

    expect(sign).toHaveBeenCalledWith(external, externalPayload);
    expect(
      request.mock.calls.some(([, path]) =>
        String(path).endsWith("/wallet-attempts"),
      ),
    ).toBe(false);
    controller.close();
  });

  it("advertises prepared wallet sends only when the adapter supports them", async () => {
    const sendPreparedTransaction = vi.fn().mockResolvedValue("0xhash");
    const preparePreparedTransaction = vi.fn();
    const payload = {
      kind: "evm_transaction" as const,
      chain_id: 8453,
      signer: "0x1111111111111111111111111111111111111111",
      nonce: 3,
      transaction: {
        to: "0x2222222222222222222222222222222222222222",
        value: "0",
        data: "0x",
        gas_limit: 21_000,
        max_fee_per_gas: "2",
        max_priority_fee_per_gas: "1",
      },
    };
    const supported = commitCapabilities({
      evm: {
        address: payload.signer,
        preparePreparedTransaction,
        sendPreparedTransaction,
      },
    });
    await expect(
      supported.walletSend?.(
        {
          ...unsigned,
          chain_family: "evm",
          chain_ref: "8453",
          signer: payload.signer,
        },
        payload,
      ),
    ).resolves.toBe("0xhash");
    await expect(
      supported.walletSendPreflight?.(
        {
          ...unsigned,
          chain_family: "evm",
          chain_ref: "8453",
          signer: payload.signer,
        },
        payload,
      ),
    ).resolves.toBeUndefined();
    expect(preparePreparedTransaction).toHaveBeenCalledWith(payload);
    expect(sendPreparedTransaction).toHaveBeenCalledWith(payload);
    expect(
      commitCapabilities({ evm: { address: payload.signer } }).walletSend,
    ).toBeUndefined();
  });

  it("keeps reviewed commit payload intact while normalizing wallet-bound target bytes", async () => {
    const mixedCase = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
    const sendPreparedTransaction = vi.fn().mockResolvedValue("0xhash");
    const capabilities = commitCapabilities({
      evm: {
        address: externalPayload.signer,
        preparePreparedTransaction: vi.fn(),
        sendPreparedTransaction,
      },
    });
    const payload = {
      ...externalPayload,
      transaction: { ...externalPayload.transaction, to: mixedCase },
    };
    await capabilities.walletSend?.(external, payload);
    expect(sendPreparedTransaction).toHaveBeenCalledWith({
      ...payload,
      transaction: {
        ...payload.transaction,
        to: getAddress(mixedCase.toLowerCase()),
      },
    });
    expect(payload.transaction.to).toBe(mixedCase);

    await expect(
      capabilities.walletSend?.(external, {
        ...payload,
        transaction: { ...payload.transaction, to: "0xNotAnAddress" },
      }),
    ).rejects.toThrow();
    expect(sendPreparedTransaction).toHaveBeenCalledTimes(1);

    const preparePreparedTransaction = vi.fn();
    const preflight = commitCapabilities({
      evm: {
        address: externalPayload.signer,
        preparePreparedTransaction,
        sendPreparedTransaction,
      },
    }).walletSendPreflight!;
    for (const invalid of ["0x1234", `0x${"g".repeat(40)}`]) {
      await expect(
        preflight(external, {
          ...payload,
          transaction: { ...payload.transaction, to: invalid },
        }),
      ).rejects.toThrow();
    }
    expect(preparePreparedTransaction).not.toHaveBeenCalled();
  });

  it("republishes when a review arrives after its view", () => {
    const controller = new CommitController(
      { request: vi.fn() } as unknown as AomiClient,
      unsigned.thread_id,
    );
    // An event page delivers the view before the tool result that carries
    // the review, and an equal-version view is never re-stored.
    controller.ingest(unsigned);
    const listener = vi.fn();
    controller.subscribe(listener);
    const review = {
      type: "execute_evm" as const,
      transactions: [],
      simulation: {
        status: "passed" as const,
        balanceChanges: [],
        approvals: [],
        fees: [],
        gas: null,
        guards: [],
        logs: [],
        warnings: [],
      },
    };
    controller.ingestReview(unsigned.commit_id, review);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.review(unsigned.commit_id)).toBe(review);
    controller.ingestReview(unsigned.commit_id, { ...review });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.review(unsigned.commit_id)).toBe(review);
    controller.close();
  });

  it("does not expose malformed durable review JSON", () => {
    const controller = new CommitController(
      { request: vi.fn() } as unknown as AomiClient,
      external.thread_id,
    );
    controller.ingest({
      ...external,
      review: {
        ...external.review!,
        request: {
          type: "execute_evm",
          transactions: [
            {
              chain_id: 8453,
              from: external.signer,
              to: "0x2222222222222222222222222222222222222222",
              data: "0x",
              label: "Transfer",
              kind: "transfer",
            },
          ],
          simulation: {
            status: "passed",
            balanceChanges: [{ asset: 7, amount: "1" }],
            approvals: [],
            fees: [],
            gas: null,
            guards: [],
            logs: [],
            warnings: [],
          },
        },
      },
    } as unknown as CommitView);
    expect(controller.review(external.commit_id)).toBeUndefined();
    controller.close();
  });

  it("reconciles a lost external broadcast response without submitting twice", async () => {
    const request = vi.fn(async (method: string) =>
      method === "GET" ? signed : submitted,
    );
    const walletBroadcast = vi.fn(async () => {
      throw new Error("lost submit response");
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
      { walletBroadcast },
    );
    await expect(controller.execute(signed.commit_id)).rejects.toThrow(
      "lost submit response",
    );
    expect((await controller.execute(signed.commit_id)).state).toBe(
      "submitted",
    );
    expect(walletBroadcast).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith(
      "POST",
      "/api/commits/cmt-one/manual",
      {
        sessionId: "thread",
        body: { kind: "broadcast", transaction_id: "chain-sig" },
      },
    );
    controller.close();
  });
  it("ignores delayed poll responses after a newer transition", async () => {
    let finish!: (view: CommitView) => void;
    const request = vi.fn(
      () =>
        new Promise<CommitView>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
    );
    const delayed = controller.refresh(unsigned.commit_id);
    controller.ingest(submitted);
    finish(unsigned);
    expect((await delayed).state).toBe("submitted");
    expect(controller.all()[0].state).toBe("submitted");
    controller.close();
  });
  it("wallet UI capability updates preserve the app Venue submitter", async () => {
    const view = { ...signed, broadcaster: "venue" as const };
    const request = vi.fn(async (method: string) =>
      method === "GET" ? view : { ...submitted, broadcaster: "venue" as const },
    );
    const venueBroadcast = vi.fn(async () => "chain-sig");
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
      { venueBroadcast },
    );
    controller.setWalletCapabilities({ sign: vi.fn() });
    await controller.execute(view.commit_id);
    expect(venueBroadcast).toHaveBeenCalledTimes(1);
    controller.close();
    await expect(controller.execute(view.commit_id)).rejects.toThrow(
      "Commit session closed",
    );
  });
  it.each(["wallet", "venue"] as const)(
    "%s signs then submits service-returned bytes; submitted is not confirmed",
    async (broadcaster) => {
      let current = { ...unsigned, broadcaster };
      const request = vi.fn(
        async (
          method: string,
          _path: string,
          options?: { body?: { kind: string } },
        ) => {
          if (method === "POST")
            current = {
              ...(options?.body?.kind === "signed" ? signed : submitted),
              broadcaster,
            };
          return current;
        },
      );
      const sign = vi.fn(async () => ["wallet-signed"]);
      const broadcast = vi.fn(async () => "chain-sig");
      const controller = new CommitController(
        { request } as unknown as AomiClient,
        "thread",
        { sign, walletBroadcast: broadcast, venueBroadcast: broadcast },
      );
      controller.ingest(current);
      const result = await controller.execute(unsigned.commit_id);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(broadcast).toHaveBeenCalledWith(
        { ...signed, broadcaster },
        "exact-signed",
      );
      expect(result.state).toBe("submitted");
      expect(isTerminalCommit(result)).toBe(false);
      await controller.execute(unsigned.commit_id);
      expect(broadcast).toHaveBeenCalledTimes(1);
      controller.ingest(unsigned);
      expect(controller.all()[0].state).toBe("submitted");
      controller.close();
    },
  );
  it("retries the signed payload after a lost POST without signing again", async () => {
    let attempts = 0;
    const request = vi.fn(async (method: string) => {
      if (method === "GET") return unsigned;
      if (++attempts === 1) throw new Error("lost response");
      return submitted;
    });
    const sign = vi.fn(async () => ["exact-signature"]);
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
      { sign },
    );
    await expect(controller.execute(unsigned.commit_id)).rejects.toThrow(
      "lost response",
    );
    await controller.execute(unsigned.commit_id);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter((c) => c[0] === "POST")).toHaveLength(2);
    controller.close();
  });
  it("Auto Venue hands off exact signed bytes with no wallet signature", async () => {
    const view = { ...signed, broadcaster: "venue" as const };
    const request = vi.fn(async (method: string) =>
      method === "GET" ? view : { ...submitted, broadcaster: "venue" as const },
    );
    const sign = vi.fn();
    const venueBroadcast = vi.fn(async () => "chain-sig");
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
      { sign, venueBroadcast },
    );
    await controller.execute(view.commit_id);
    expect(sign).not.toHaveBeenCalled();
    expect(venueBroadcast).toHaveBeenCalledWith(view, "exact-signed");
    controller.close();
  });
  it("never sends through a client broadcaster for Hosted", async () => {
    const request = vi.fn(async () => ({
      ...submitted,
      broadcaster: "hosted",
    }));
    const send = vi.fn();
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
      { walletBroadcast: send, venueBroadcast: send },
    );
    await controller.execute(unsigned.commit_id);
    expect(send).not.toHaveBeenCalled();
    controller.close();
  });
});

describe("send_calls bundles", () => {
  const memberPayload = {
    ...externalPayload,
    nonce: 8,
    transaction: {
      ...externalPayload.transaction,
      to: "0x3333333333333333333333333333333333333333",
      data: "0x5678",
    },
  };
  const batch = (index: number) => ({
    batch_id: "batch-1",
    index,
    ordered_stage_ids: ["evm:1", "evm:2"],
    ordered_commit_ids: ["cmt-leader", "cmt-member"],
    sources: [],
    predecessor_commit_id: index ? "cmt-leader" : null,
    review_digest: "batch-digest",
  });
  const leader: CommitView = {
    ...external,
    commit_id: "cmt-leader",
    stage_id: "evm:1",
    supported_transports: ["sign_and_broadcast", "browser_send", "send_calls"],
    batch: batch(0),
  };
  const member: CommitView = {
    ...external,
    commit_id: "cmt-member",
    stage_id: "evm:2",
    batch: batch(1),
    action: { kind: "sign", payload: memberPayload },
  };
  const bundleRequest = {
    kind: "wallet_calls" as const,
    chain_id: 8453,
    signer: external.signer,
    calls: [externalPayload, memberPayload].map(({ transaction }) => ({
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      gas_limit: transaction.gas_limit,
    })),
  };
  const bundleAttempt = {
    attempt_id: "attempt-1",
    transport: "send_calls",
    commit_id: leader.commit_id,
    state: "awaiting_wallet",
    request: bundleRequest,
    may_invoke_wallet: true,
  };
  const leaderAttempt = {
    attempt_id: "attempt-1",
    transport: "send_calls" as const,
    state: "awaiting_wallet" as const,
    transaction_id: null,
    failure_code: null,
  };
  const reported = (
    transactionId: string,
    transport: "send_calls" | "browser_send" = "send_calls",
  ): CommitView => ({
    ...leader,
    version: 2,
    state: "submitted",
    action: null,
    transaction_id: transactionId,
    wallet_attempt: {
      ...leaderAttempt,
      transport,
      state: "observing",
      transaction_id: transactionId,
    },
  });
  const views = (...list: CommitView[]) =>
    new Map(list.map((view) => [view.commit_id, view]));

  function setup({
    atomic = true,
    walletSendCalls = vi.fn().mockResolvedValue(["0xbundle"]),
    walletCallsStatus,
    current = views(leader, member),
  }: {
    atomic?: boolean;
    walletCallsStatus?: CommitCapabilities["walletCallsStatus"];
    walletSendCalls?: NonNullable<CommitCapabilities["walletSendCalls"]>;
    current?: Map<string, CommitView>;
  } = {}) {
    const recovery = recoveryStore();
    const walletSend = vi.fn().mockResolvedValue("0xsingle");
    const walletSendPreflight = vi.fn();
    const canWalletSendCalls = vi.fn(() => atomic);
    const reports: unknown[] = [];
    const attempts: unknown[] = [];
    const request = vi.fn(async (method: string, path: string, options) => {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      if (method === "GET") return current.get(id);
      if (path.endsWith("/wallet-attempts")) {
        attempts.push(options.body);
        return options.body.transport === "send_calls"
          ? bundleAttempt
          : {
              ...bundleAttempt,
              transport: "browser_send",
              commit_id: id,
              request: current.get(id)?.action?.payload,
            };
      }
      reports.push({
        body: options.body,
        saved: recovery.records.get(id),
      });
      const next =
        options.body.kind === "rejected"
          ? { ...leader, version: 2, state: "rejected" as const, action: null }
          : options.body.kind === "calls"
            ? reported(options.body.transaction_ids.at(-1))
            : reported(options.body.transaction_id, "browser_send");
      current.set(id, { ...next, commit_id: id });
      return current.get(id);
    });
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      external.thread_id,
      {
        walletSend,
        walletSendPreflight,
        walletSendCalls,
        walletCallsStatus,
        canWalletSendCalls,
        recovery: recovery.store,
      },
    );
    return {
      controller,
      recovery,
      request,
      walletSend,
      walletSendCalls,
      reports,
      attempts,
    };
  }

  it("sends every batch member as one bundle and reports its hashes", async () => {
    const walletSendCalls = vi.fn().mockResolvedValue(["0xbundle"]);
    const { controller, recovery, walletSend, reports, attempts, request } =
      setup({ walletSendCalls });
    controller.ingest(leader);
    controller.ingest(member);

    expect(controller.canExecute(leader)).toBe(true);
    await expect(controller.execute(leader.commit_id)).resolves.toMatchObject({
      state: "submitted",
      transaction_id: "0xbundle",
    });

    expect(attempts).toEqual([
      {
        version: leader.version,
        review_digest: "review-digest",
        client_request_id: expect.any(String),
        transport: "send_calls",
      },
    ]);
    expect(walletSendCalls).toHaveBeenCalledTimes(1);
    expect(walletSendCalls).toHaveBeenCalledWith(
      expect.objectContaining({ commit_id: leader.commit_id }),
      bundleRequest,
      expect.any(Function),
      expect.any(Function),
    );
    expect(walletSend).not.toHaveBeenCalled();
    expect(reports).toEqual([
      {
        body: { kind: "calls", transaction_ids: ["0xbundle"] },
        saved: expect.objectContaining({
          attemptId: "attempt-1",
          transactionIds: ["0xbundle"],
        }),
      },
    ]);
    expect(recovery.records.size).toBe(0);

    // The member rides the bundle: no attempt of its own.
    expect(controller.canExecute(member)).toBe(false);
    await controller.execute(member.commit_id);
    expect(attempts).toHaveLength(1);
    expect(
      request.mock.calls.filter(([method]) => method === "POST"),
    ).toHaveLength(2);
    controller.close();
  });

  it("keeps per-leg browser sends when the wallet has no atomic batches", async () => {
    const { controller, walletSend, walletSendCalls, attempts } = setup({
      atomic: false,
    });

    await controller.execute(leader.commit_id);

    expect(attempts).toEqual([
      expect.objectContaining({ transport: "browser_send" }),
    ]);
    expect(walletSend).toHaveBeenCalledTimes(1);
    expect(walletSendCalls).not.toHaveBeenCalled();
    expect(controller.canExecute(member)).toBe(true);
    controller.close();
  });

  it("reports recorded bundle hashes after a reload without invoking the wallet", async () => {
    const walletSendCalls = vi.fn();
    const awaiting: CommitView = {
      ...leader,
      action: null,
      wallet_attempt: leaderAttempt,
    };
    const { controller, recovery, reports, attempts } = setup({
      walletSendCalls,
      current: views(awaiting, member),
    });
    recovery.records.set(leader.commit_id, {
      clientRequestId: "request-1",
      attemptId: "attempt-1",
      transactionIds: ["0xone", "0xtwo"],
    });

    expect(controller.canExecute(awaiting)).toBe(true);
    await expect(controller.execute(leader.commit_id)).resolves.toMatchObject({
      state: "submitted",
    });

    expect(walletSendCalls).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
    expect(reports).toEqual([
      {
        body: { kind: "calls", transaction_ids: ["0xone", "0xtwo"] },
        saved: expect.anything(),
      },
    ]);
    controller.close();
  });

  it("reports an explicit rejection of the bundle", async () => {
    const walletSendCalls: NonNullable<CommitCapabilities["walletSendCalls"]> =
      vi.fn(async (_commit, _request, onPhase) => {
        onPhase?.("awaiting_wallet");
        throw new Error("Wallet batch request failed", {
          cause: { code: 4001 },
        });
      });
    const { controller, reports } = setup({ walletSendCalls });

    await expect(controller.execute(leader.commit_id)).resolves.toMatchObject({
      state: "rejected",
    });

    expect(reports).toEqual([
      {
        body: {
          kind: "rejected",
          phase: "transaction_request",
          provider_code: "4001",
          reason_category: "user_rejected",
        },
        saved: expect.objectContaining({ rejected: true }),
      },
    ]);
    controller.close();
  });

  it("reports the legs a sequential fallback sent before it stopped", async () => {
    const walletSendCalls = vi
      .fn()
      .mockRejectedValue(
        new PartialWalletExecutionError(new Error("rpc down"), ["0xone"], 1),
      );
    const { controller, reports } = setup({ walletSendCalls });

    await controller.execute(leader.commit_id);

    expect(reports).toEqual([
      {
        body: { kind: "calls", transaction_ids: ["0xone"] },
        saved: expect.objectContaining({ transactionIds: ["0xone"] }),
      },
    ]);
    controller.close();
  });

  it("plans each group by what it is and what the wallet can do", () => {
    const wallet = {
      walletSend: vi.fn(),
      walletSendPreflight: vi.fn(),
      walletSendCalls: vi.fn(),
      recovery: recoveryStore().store,
    };
    const bundles = { ...wallet, canWalletSendCalls: () => true };
    const refuses = { ...wallet, canWalletSendCalls: () => false };
    const groupPlan = (view: CommitView, capabilities: CommitCapabilities) =>
      new CommitController(
        {} as AomiClient,
        external.thread_id,
        capabilities,
      ).plan(view);
    // A batch of two on a wallet that bundles: one prompt, all together.
    expect(groupPlan(leader, bundles)).toEqual({
      transport: "send_calls",
      prompts: 1,
      atomic: true,
    });
    // A lone commit bundles too.
    expect(groupPlan({ ...leader, batch: null }, bundles)).toEqual({
      transport: "send_calls",
      prompts: 1,
      atomic: true,
    });
    // A wallet known to refuse bundles: one prompt per member, in order.
    expect(groupPlan(leader, refuses)).toEqual({
      transport: "browser_send",
      prompts: 2,
      atomic: false,
    });
    // An attempt that went out as a bundle the wallet then refused.
    expect(
      groupPlan({ ...leader, wallet_attempt: leaderAttempt }, refuses),
    ).toEqual({ transport: "send_calls", prompts: 2, atomic: false });
    // An agent wallet: Aomi signs after approval, as one operation or one
    // transaction per member.
    expect(
      groupPlan(
        {
          ...leader,
          state: "awaiting_approval",
          signing_mode: "auto",
          approval: {
            state: "pending",
            client: null,
            expires_at: 1,
            approved_at: null,
            approved_by: null,
          },
        },
        bundles,
      ),
    ).toEqual({ transport: "agent", prompts: 0, atomic: false });
    // A message is its own group, signed once.
    const message: CommitView = {
      ...external,
      supported_transports: ["sign_and_broadcast"],
      action: {
        kind: "sign",
        payload: {
          kind: "evm_message",
          chain_id: 8453,
          signer: external.signer,
          digest: `0x${"ab".repeat(32)}`,
          message: { format: "personal", message: "Sign in to Hoodit." },
        },
      },
    };
    expect(groupPlan(message, bundles)).toEqual({
      transport: "sign_and_broadcast",
      prompts: 1,
      atomic: true,
    });
  });

  it("shares only transient progress across an atomic group", async () => {
    const phases: unknown[] = [];
    const { controller } = setup({
      walletSendCalls: vi.fn(async (_commit, _request, onPhase) => {
        onPhase?.("awaiting_wallet");
        phases.push(controller.submissionPhase(member.commit_id));
        return ["0xbundle"];
      }),
    });
    controller.ingest(leader);
    controller.ingest(member);
    await controller.execute(leader.commit_id);
    // Sending, then Submitted with its leader, yet still its own commit.
    expect(phases).toEqual(["awaiting_wallet"]);
    const own = controller.all()[1];
    expect(controller.groupView(own)).toEqual({ ...own, state: "submitted" });
    expect(own).toMatchObject({
      state: "needs_signature",
      transaction_id: null,
    });
    // A settled leader lends nothing: the member waits for its own result.
    controller.ingest({
      ...reported("0xbundle"),
      version: 3,
      state: "confirmed",
    });
    expect(controller.groupView(own)).toBe(own);
    controller.close();
  });

  it("moves an agent group's members each by its own view", () => {
    const agent = (view: CommitView, patch: Partial<CommitView> = {}) => ({
      ...view,
      signing_mode: "auto",
      broadcaster: "hosted" as const,
      supported_transports: [],
      action: null,
      ...patch,
    });
    const { controller } = setup();
    controller.ingest(
      agent(leader, {
        version: 2,
        state: "submitted",
        transaction_id: "0xone",
      }),
    );
    controller.ingest(agent(member));
    const own = controller.all()[1];
    expect(controller.plan(own)).toMatchObject({ atomic: false });
    expect(controller.groupView(own)).toBe(own);
    expect(controller.submissionPhase(own.commit_id)).toBeUndefined();
    controller.close();
  });

  it("moves an agent group the backend runs as one operation together", () => {
    const agent = (view: CommitView, patch: Partial<CommitView> = {}) => ({
      ...view,
      signing_mode: "auto",
      broadcaster: "hosted" as const,
      supported_transports: [],
      action: null,
      atomic: true,
      ...patch,
    });
    const { controller } = setup();
    controller.ingest(agent(leader, { version: 2, state: "submitted" }));
    controller.ingest(agent(member));
    const own = controller.all()[1];
    expect(controller.plan(own)).toEqual({
      transport: "agent",
      prompts: 0,
      atomic: true,
    });
    expect(controller.groupView(own)).toEqual({ ...own, state: "submitted" });
    controller.close();
  });

  it("never reads a failure after an accepted bundle as a rejection", async () => {
    const walletSendCalls: NonNullable<CommitCapabilities["walletSendCalls"]> =
      vi.fn(async (_commit, _request, onPhase) => {
        onPhase?.("awaiting_wallet");
        throw new Error("Wallet batch request failed", {
          cause: Object.assign(new Error("status unknown"), {
            callsId: "0xid",
            cause: { code: 4001 },
          }),
        });
      });
    const { controller, recovery, reports } = setup({ walletSendCalls });

    await expect(controller.execute(leader.commit_id)).rejects.toThrow(
      "Wallet batch request failed",
    );

    expect(reports).toEqual([]);
    // The attempt stays to reconcile: Check status, never a new prompt.
    expect(recovery.records.get(leader.commit_id)).toEqual({
      clientRequestId: expect.any(String),
      attemptId: "attempt-1",
      callsId: "0xid",
      walletError: "Wallet batch request failed: status unknown: (code 4001)",
    });
    controller.close();
  });

  it("checks a saved bundle after reload and reports its hashes without sending again", async () => {
    const walletCallsStatus = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        kind: "calls",
        transaction_ids: ["0xrecovered"],
      });
    const current = views(
      { ...leader, action: null, wallet_attempt: leaderAttempt },
      member,
    );
    const { controller, recovery, reports, walletSendCalls, attempts } = setup({
      current,
      walletCallsStatus,
    });
    recovery.store.save(leader.thread_id, leader.commit_id, {
      clientRequestId: "original-request",
      attemptId: "attempt-1",
      callsId: "0xid",
      walletError: "original provider failure",
    });
    expect(controller.canExecute(current.get(leader.commit_id)!)).toBe(true);
    await controller.execute(leader.commit_id);
    expect(reports).toEqual([]);
    expect(recovery.records.get(leader.commit_id)?.walletError).toBe(
      "original provider failure",
    );
    const settled = await controller.execute(leader.commit_id);
    expect(settled.state).toBe("submitted");
    expect(walletCallsStatus).toHaveBeenCalledWith(
      expect.objectContaining({ commit_id: leader.commit_id }),
      "0xid",
    );
    expect(reports).toMatchObject([
      { body: { kind: "calls", transaction_ids: ["0xrecovered"] } },
    ]);
    expect(walletSendCalls).not.toHaveBeenCalled();
    expect(attempts).toEqual([]);
    expect(recovery.records.has(leader.commit_id)).toBe(false);
    controller.close();
  });

  it("persists a proven offchain failure before reporting it and never sends again", async () => {
    const walletCallsStatus = vi
      .fn()
      .mockResolvedValue({ kind: "calls_not_submitted", calls_id: "0xid" });
    const current = views(
      { ...leader, action: null, wallet_attempt: leaderAttempt },
      member,
    );
    const { controller, recovery, reports, walletSendCalls } = setup({
      current,
      walletCallsStatus,
    });
    recovery.store.save(leader.thread_id, leader.commit_id, {
      clientRequestId: "original",
      attemptId: "attempt-1",
      callsId: "0xid",
    });
    await controller.execute(leader.commit_id);
    expect(reports).toMatchObject([
      {
        body: { kind: "calls_not_submitted", calls_id: "0xid" },
        saved: { callsNotSubmitted: true },
      },
    ]);
    expect(walletSendCalls).not.toHaveBeenCalled();
    controller.close();
  });

  it("keeps a different attempt's saved bundle blocked", async () => {
    const walletCallsStatus = vi
      .fn()
      .mockResolvedValue({
        kind: "calls_not_submitted",
        calls_id: "old-bundle",
      });
    const current = views(
      { ...leader, action: null, wallet_attempt: leaderAttempt },
      member,
    );
    const { controller, recovery, reports, walletSendCalls } = setup({
      current,
      walletCallsStatus,
    });
    recovery.store.save(leader.thread_id, leader.commit_id, {
      clientRequestId: "old",
      attemptId: "old-attempt",
      callsId: "old-bundle",
    });
    await controller.execute(leader.commit_id);
    expect(walletCallsStatus).not.toHaveBeenCalled();
    expect(walletSendCalls).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
    controller.close();
  });

  it("saves a bundle ID while its result is still pending", async () => {
    let finish!: (hashes: string[]) => void;
    const walletSendCalls: NonNullable<CommitCapabilities["walletSendCalls"]> =
      vi.fn(async (_commit, _request, _phase, onAccepted) => {
        onAccepted?.("0xaccepted");
        return new Promise<string[]>((resolve) => {
          finish = resolve;
        });
      });
    const { controller, recovery } = setup({ walletSendCalls });
    const sending = controller.execute(leader.commit_id);
    await vi.waitFor(() =>
      expect(recovery.records.get(leader.commit_id)?.callsId).toBe(
        "0xaccepted",
      ),
    );
    finish(["0xreceipt"]);
    await sending;
    controller.close();
  });

  it("retains bounded non-Error wallet diagnostics without serializing provider data", async () => {
    const failure = {
      message: "Internal wallet failure\nRequest body: private body",
      code: -32603,
      providerResponse: { token: "must not persist" },
    };
    const { controller, recovery, reports } = setup({
      walletSendCalls: vi.fn().mockRejectedValue(failure),
    });
    await expect(controller.execute(leader.commit_id)).rejects.toBe(failure);
    expect(recovery.records.get(leader.commit_id)?.walletError).toBe(
      "Internal wallet failure (code -32603)",
    );
    expect(
      JSON.stringify(recovery.records.get(leader.commit_id)),
    ).not.toContain("private body");
    expect(
      JSON.stringify(recovery.records.get(leader.commit_id)),
    ).not.toContain("must not persist");
    expect(reports).toEqual([]);
    controller.close();
  });

  it("offers bundles only for a wallet that batches atomically on the chain", () => {
    const evm = {
      address: external.signer,
      sendPreparedCalls: vi.fn(),
      supportsAtomicBatch: vi.fn((chainId: number) => chainId === 8453),
    };
    const capabilities = commitCapabilities({ evm });
    expect(capabilities.canWalletSendCalls?.(leader)).toBe(true);
    expect(
      capabilities.canWalletSendCalls?.({ ...leader, chain_ref: "1" }),
    ).toBe(false);
    expect(
      commitCapabilities({ evm: { address: external.signer } }).walletSendCalls,
    ).toBeUndefined();
  });
});

describe("message commits", () => {
  const signer = "0x1111111111111111111111111111111111111111";
  const typedData = {
    domain: {
      name: "Permit2",
      chainId: 8453,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
    types: {
      PermitSingle: [{ name: "spender", type: "address" }],
    },
    primaryType: "PermitSingle",
    message: { spender: "0x2222222222222222222222222222222222222222" },
  };
  const messageReview = {
    type: "sign",
    requestId: "evm-message:abc",
    chainFamily: "evm",
    executionKind: "evm_message",
    signer,
    chainId: 8453,
    description: "Allow USDC for Permit2",
    payloads: [{ kind: "evm_typed_data", typed_data: typedData }],
    messageReview: { kind: "permit2", rows: [] },
  } as const;
  const message = (payload: EvmCommitMessage): CommitView => ({
    ...external,
    commit_id: "cmt-message",
    stage_id: "evm-message:abc",
    supported_transports: ["sign_and_broadcast"],
    version: 3,
    review: {
      version: 2,
      revision: 1,
      digest: "message-digest",
      request: messageReview,
      legs: [],
    },
    action: {
      kind: "sign",
      payload: {
        kind: "evm_message",
        chain_id: 8453,
        signer,
        digest: `0x${"ab".repeat(32)}`,
        message: payload,
      },
    },
  });
  const confirmed = (view: CommitView): CommitView => ({
    ...view,
    version: view.version + 1,
    state: "confirmed",
    action: null,
    signature: "0xsigned",
  });

  function run(
    view: CommitView,
    wallet: Parameters<typeof commitCapabilities>[0]["evm"],
  ) {
    const posts: unknown[] = [];
    const request = vi.fn(
      async (method: string, path: string, options?: { body?: unknown }) => {
        if (method === "GET") return view;
        expect(path).toBe(`/api/commits/${view.commit_id}/manual`);
        posts.push(options?.body);
        return confirmed(view);
      },
    );
    const controller = new CommitController(
      { request } as unknown as AomiClient,
      view.thread_id,
      commitCapabilities({ evm: wallet }, recoveryStore().store),
    );
    return { controller, posts };
  }

  it("signs typed data in the browser wallet and reports it for the reviewed version", async () => {
    const view = message({ format: "typed_data", typed_data: typedData });
    const signPreparedMessage = vi.fn(async () => "0xsigned");
    const switchChain = vi.fn(async () => undefined);
    const sendPreparedTransaction = vi.fn();
    const { controller, posts } = run(view, {
      address: signer,
      signPreparedMessage,
      switchChain,
      sendPreparedTransaction,
      preparePreparedTransaction: vi.fn(),
    });

    controller.ingest(view);
    expect(controller.review(view.commit_id)).toMatchObject({
      executionKind: "evm_message",
      description: "Allow USDC for Permit2",
    });
    expect(controller.canExecute(view)).toBe(true);
    await expect(
      controller.execute(view.commit_id, {
        expectedVersion: 3,
        expectedReviewDigest: "message-digest",
      }),
    ).resolves.toMatchObject({ state: "confirmed", signature: "0xsigned" });

    expect(signPreparedMessage).toHaveBeenCalledWith(
      view.action?.kind === "sign" ? view.action.payload : undefined,
    );
    expect(switchChain).toHaveBeenCalledWith(8453);
    expect(sendPreparedTransaction).not.toHaveBeenCalled();
    expect(posts).toEqual([
      {
        kind: "signed",
        payloads: ["0xsigned"],
        version: 3,
        review_digest: "message-digest",
      },
    ]);
    controller.close();
  });

  it("signs an ERC-191 message without switching chains", async () => {
    const view = message({ format: "personal", message: "Sign in to Hoodit." });
    const signPreparedMessage = vi.fn(async () => "0xsigned");
    const switchChain = vi.fn(async () => undefined);
    const { controller, posts } = run(view, {
      address: signer,
      signPreparedMessage,
      switchChain,
    });
    await controller.execute(view.commit_id);
    expect(signPreparedMessage.mock.calls[0]?.[0]).toMatchObject({
      message: { format: "personal", message: "Sign in to Hoodit." },
    });
    expect(switchChain).not.toHaveBeenCalled();
    expect(posts).toEqual([
      {
        kind: "signed",
        payloads: ["0xsigned"],
        version: 3,
        review_digest: "message-digest",
      },
    ]);
    controller.close();
  });

  it("signs with a wallet that has only signMessage and signTypedData", async () => {
    // The CLI, headless, Privy and Para adapters: no prepared-message signer.
    const signMessage = vi.fn(async () => ({ signature: "0xsigned" }));
    const signTypedData = vi.fn(async () => "0xsigned");
    const switchChain = vi.fn(async () => undefined);
    const wallet = { address: signer, signMessage, signTypedData, switchChain };

    const personal = message({ format: "personal", message: "0x68656c6c6f" });
    const first = run(personal, wallet);
    first.controller.ingest(personal);
    expect(first.controller.canExecute(personal)).toBe(true);
    await first.controller.execute(personal.commit_id);
    // `0x` hex goes through unchanged; the adapter signs it as its bytes.
    expect(signMessage).toHaveBeenCalledWith({
      message: "0x68656c6c6f",
      chainId: 8453,
    });
    expect(first.posts).toMatchObject([{ payloads: ["0xsigned"] }]);
    first.controller.close();

    const typed = message({ format: "typed_data", typed_data: typedData });
    const second = run(typed, wallet);
    await second.controller.execute(typed.commit_id);
    expect(signTypedData).toHaveBeenCalledWith({
      typedData,
      chainId: 8453,
    });
    expect(switchChain).toHaveBeenCalledWith(8453);
    expect(second.posts).toMatchObject([{ payloads: ["0xsigned"] }]);
    second.controller.close();
  });

  it("refuses to sign with a different connected address", async () => {
    const view = message({ format: "personal", message: "hello" });
    const signPreparedMessage = vi.fn(async () => "0xsigned");
    const { controller, posts } = run(view, {
      address: "0x9999999999999999999999999999999999999999",
      signPreparedMessage,
    });
    controller.ingest(view);
    expect(controller.canExecute(view)).toBe(false);
    await expect(controller.execute(view.commit_id)).rejects.toThrow(
      "Connect the expected signing wallet",
    );
    expect(signPreparedMessage).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
    controller.close();
  });

  it("reads a confirmed message as Signed, with no transaction", () => {
    const view = confirmed(message({ format: "personal", message: "hello" }));
    expect(projectCommitLifecycle(view)).toEqual({
      phase: "confirmed",
      label: "Signed",
    });
  });
});
