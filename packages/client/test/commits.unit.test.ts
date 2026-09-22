import { describe, it, expect, vi } from "vitest";
import {
  commitCapabilities,
  CommitController,
  isTerminalCommit,
  type CommitRecoveryRecord,
  type CommitRecoveryStore,
  type CommitView,
} from "../src/commits";
import type { AomiClient } from "../src/client";

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

  it.each([false, true])(
    "reports an explicit provider rejection through its bound attempt (wrapped: %s)",
    async (wrapped) => {
      const recovery = recoveryStore();
      const rejected = { code: 4001 };
      const walletSend = vi
        .fn()
        .mockRejectedValue(
          wrapped
            ? new Error("Wallet request failed", { cause: rejected })
            : rejected,
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
        expect(options.body).toEqual({ kind: "rejected" });
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
