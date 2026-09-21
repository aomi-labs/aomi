import { describe, it, expect, vi } from "vitest";
import {
  CommitController,
  isTerminalCommit,
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

describe("Commit view surfaces", () => {
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
