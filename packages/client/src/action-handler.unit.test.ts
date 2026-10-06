import { describe, expect, it, vi } from "vitest";

import { ActionHandler } from "../src";
import type { CommitController, CommitView } from "../src/commits";
import type { Action, ActionResult } from "../src";

function action(overrides: Partial<Action> = {}): Action {
  return {
    type: "action",
    event_id: "event-action-1",
    sequence: 1,
    turn_id: "turn-1",
    occurred_at: 1,
    id: "action-1",
    revision: 1,
    state: "pending",
    request: {
      type: "execute_evm",
      transactions: [
        {
          chain_id: 1,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
    },
    result: null,
    created_at: 1,
    expires_at: null,
    ...overrides,
  };
}

const submitted: ActionResult = {
  status: "submitted",
  legs: [{ id: "leg_1", status: "submitted", transactionId: "0xsubmitted" }],
};

describe("ActionHandler", () => {
  it("owns execution, response, and the acknowledged revision", async () => {
    const capability = vi.fn().mockResolvedValue(submitted);
    const respond = vi.fn(async (current: Action, result: ActionResult) =>
      action({
        event_id: "event-action-2",
        sequence: 2,
        revision: current.revision + 1,
        state: "submitted",
        result,
      }),
    );
    const handler = new ActionHandler({ execute_evm: capability }, respond);
    handler.ingest(action());

    await expect(handler.execute("action-1")).resolves.toMatchObject({
      revision: 2,
      state: "submitted",
    });

    expect(capability).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ id: "action-1", revision: 1 }),
      submitted,
      expect.any(String),
    );
    expect(handler.pending()).toEqual([]);
    expect(handler.attempt("action-1")).toBeUndefined();
  });

  it("retries a cached result without executing the capability again", async () => {
    const capability = vi.fn().mockResolvedValue(submitted);
    const respond = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockImplementationOnce(async (current: Action, result: ActionResult) =>
        action({
          event_id: "event-action-2",
          sequence: 2,
          revision: current.revision + 1,
          state: "submitted",
          result,
        }),
      );
    const handler = new ActionHandler({ execute_evm: capability }, respond);
    handler.ingest(action());

    await expect(handler.execute("action-1")).rejects.toThrow(
      "network unavailable",
    );
    await expect(handler.retry("action-1")).resolves.toMatchObject({
      revision: 2,
    });

    expect(capability).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledTimes(2);
    expect(respond.mock.calls[0]?.[2]).toBe(respond.mock.calls[1]?.[2]);
  });

  it("models rejection as an explicit response", async () => {
    const respond = vi.fn(async (current: Action, result: ActionResult) =>
      action({
        event_id: "event-action-2",
        sequence: 2,
        revision: current.revision + 1,
        state: "rejected",
        result,
      }),
    );
    const handler = new ActionHandler({}, respond);
    handler.ingest(action());

    await handler.reject("action-1", "Declined");

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ id: "action-1", revision: 1 }),
      { status: "rejected", reason: "Declined" },
      expect.any(String),
    );
  });
});

describe("durable ExecuteEvm Action bridge", () => {
  function linked() {
    const current = action();
    Object.assign(current.request, { commitStages: ["stage-1"] });
    return current;
  }
  function controller(views: CommitView[]) {
    return {
      threadId: "thread-1",
      all: () => views,
      refresh: vi.fn(async (_id: string) => views[0]!),
      execute: vi.fn(async () => ({ ...views[0]!, state: "submitted" })),
      reject: vi.fn(async () => ({ ...views[0]!, state: "rejected" })),
      canExecute: () => true,
    };
  }
  const view = {
    commit_id: "commit-1",
    stage_id: "stage-1",
    thread_id: "thread-1",
    state: "needs_signature",
  } as CommitView;
  it("waits for canonical views without a direct send or outcome report", async () => {
    const send = vi.fn();
    const respond = vi.fn();
    const commits = controller([]);
    const handler = new ActionHandler(
      { execute_evm: send },
      respond,
      commits as unknown as CommitController,
    );
    handler.ingest(linked());
    expect(handler.canExecute("action-1")).toBe(false);
    await expect(handler.execute("action-1")).rejects.toThrow("still loading");
    expect(send).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    expect(commits.execute).not.toHaveBeenCalled();
  });
  it("delegates execution and cancellation to the durable controller, preserving original identity", async () => {
    const send = vi.fn();
    const respond = vi.fn();
    const commits = controller([view]);
    const handler = new ActionHandler(
      { execute_evm: send },
      respond,
      commits as unknown as CommitController,
    );
    handler.ingest(linked());
    await expect(handler.execute("action-1")).resolves.toMatchObject({
      id: "action-1",
      state: "pending",
    });
    expect(commits.execute).toHaveBeenCalledWith("commit-1");
    expect(() => handler.submitResult("action-1", submitted)).toThrow(
      "Commit Service",
    );
    await handler.reject("action-1");
    expect(commits.reject).toHaveBeenCalledWith("commit-1");
    expect(send).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    expect(handler.allAttempts().size).toBe(0);
  });
  it("does not invoke again while the durable attempt awaits confirmation", async () => {
    const commits = controller([{ ...view, state: "submitted" }]);
    const handler = new ActionHandler(
      {},
      vi.fn(),
      commits as unknown as CommitController,
    );
    handler.ingest(linked());
    await handler.execute("action-1");
    expect(commits.execute).not.toHaveBeenCalled();
  });
  it("rejects linked references from another thread before using any capability", async () => {
    const send = vi.fn();
    const commits = controller([{ ...view, thread_id: "other-thread" }]);
    const handler = new ActionHandler(
      { execute_evm: send },
      vi.fn(),
      commits as unknown as CommitController,
    );
    handler.ingest(linked());
    expect(handler.canExecute("action-1")).toBe(false);
    await expect(handler.execute("action-1")).rejects.toThrow(
      "cohort identity mismatch",
    );
    expect(commits.refresh).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("requires the immutable complete cohort and reconciles a confirmed predecessor", async () => {
    const current = linked();
    if (current.request.type !== "execute_evm")
      throw new Error("expected EVM request");
    current.request.transactions.push({
      ...current.request.transactions[0]!,
      label: "Second leg",
    });
    current.request.commitStages = ["stage-1", "stage-2"];
    const ordered = ["commit-1", "commit-2"];
    const stages = ["stage-1", "stage-2"];
    const views = stages.map((stage_id, index) => ({
      ...view,
      stage_id,
      commit_id: ordered[index]!,
      state: index === 0 ? "confirmed" : "needs_signature",
      batch: {
        batch_id: "batch",
        index,
        total: 2,
        ordered_stage_ids: stages,
        ordered_commit_ids: ordered,
      },
    })) as CommitView[];
    const commits = controller(views);
    commits.refresh.mockImplementation(
      async (id: string) => views.find((entry) => entry.commit_id === id)!,
    );
    const handler = new ActionHandler(
      {},
      vi.fn(),
      commits as unknown as CommitController,
    );
    handler.ingest(current);
    await handler.execute(current.id);
    expect(commits.execute).toHaveBeenCalledTimes(1);
    expect(commits.execute).toHaveBeenCalledWith("commit-2");
    views[1] = {
      ...views[1]!,
      batch: { ...views[1]!.batch!, ordered_stage_ids: [...stages].reverse() },
    };
    await expect(handler.execute(current.id)).rejects.toThrow(
      "cohort identity mismatch",
    );
    expect(commits.execute).toHaveBeenCalledTimes(1);
  });
});


describe("ordinary EVM signature admission", () => {
  const request = {
    type: "sign", requestId: "signature", chainFamily: "evm",
    executionKind: "message", signer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    chainId: 1, description: "Sign permit", payloads: [{ kind: "evm_personal", message: "0x01" }],
  } as const;

  it("never invokes or reports a legacy execution signature, including retries", async () => {
    const sign = vi.fn().mockResolvedValue({ status: "signed", outputs: [{ id: "signature", signature: "0xsigned" }] });
    const respond = vi.fn();
    const handler = new ActionHandler({ sign }, respond);
    handler.ingest(action({ request: { ...request, payloads: [...request.payloads] } }));
    expect(handler.canExecute("action-1")).toBe(false);
    await expect(handler.execute("action-1")).rejects.toThrow("fresh safety admission");
    await expect(handler.retry("action-1")).rejects.toThrow("fresh safety admission");
    expect(() => handler.submitResult("action-1", { status: "signed", outputs: [{ id: "signature", signature: "0xsigned" }] })).toThrow("fresh safety admission");
    expect(sign).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it("preserves excluded AA signing and allows rejecting a blocked signature", async () => {
    const sign = vi.fn().mockResolvedValue({ status: "signed", outputs: [{ id: "signature", signature: "0xsigned" }] });
    const respond = vi.fn(async (current: Action, result: ActionResult) => ({ ...current, revision: 2, state: "completed" as const, result }));
    const handler = new ActionHandler({ sign }, respond);
    handler.ingest(action({ request: { ...request, executionKind: "erc4337", payloads: [...request.payloads] } }));
    await handler.execute("action-1");
    expect(sign).toHaveBeenCalledOnce();
    const blocked = new ActionHandler({ sign }, respond);
    blocked.ingest(action({ request: { ...request, payloads: [...request.payloads] } }));
    await blocked.reject("action-1");
    expect(respond).toHaveBeenLastCalledWith(expect.anything(), { status: "rejected", reason: "Request rejected" }, expect.any(String));
  });
});
