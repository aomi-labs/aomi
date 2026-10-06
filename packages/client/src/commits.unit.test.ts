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
} from "./commits";
import type { AomiClient } from "./client";

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
