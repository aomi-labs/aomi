import { describe, expect, it, vi } from "vitest";

import { ActionHandler } from "../src";
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

describe("signing Action safety", () => {
  const signed: ActionResult = {
    status: "signed",
    outputs: [{ id: "payload_1", signature: "fixture" }],
  };
  const signingAction = (overrides: Partial<Action> = {}): Action =>
    action({
      request: {
        type: "sign",
        requestId: "sign-1",
        chainFamily: "evm",
        executionKind: "message",
        signer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chainId: 1337,
        description: "Domain test",
        payloads: [],
      },
      ...overrides,
    });
  const acknowledge = async (current: Action, result: ActionResult) => ({
    ...current,
    revision: current.revision + 1,
    state: "completed" as const,
    result,
  });

  it("coalesces duplicate clicks and never signs again when retrying delivery", async () => {
    let resolve!: (result: Extract<ActionResult, { status: "signed" }>) => void;
    const sign = vi.fn(
      () =>
        new Promise<Extract<ActionResult, { status: "signed" }>>((done) => {
          resolve = done;
        }),
    );
    const respond = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(acknowledge);
    const handler = new ActionHandler({ sign }, respond);
    handler.ingest(signingAction());
    const first = handler.execute("action-1");
    expect(handler.execute("action-1")).toBe(first);
    resolve(signed as Extract<ActionResult, { status: "signed" }>);
    await expect(first).rejects.toThrow("offline");
    await handler.retry("action-1");
    expect(sign).toHaveBeenCalledOnce();
    expect(respond.mock.calls[0][2]).toBe(respond.mock.calls[1][2]);
    expect(() => handler.execute("action-1")).toThrow("No pending Action");
  });

  it("does not submit a wallet rejection or automatically retry signing", async () => {
    const sign = vi.fn().mockRejectedValue(new Error("User rejected"));
    const respond = vi.fn(acknowledge);
    const handler = new ActionHandler({ sign }, respond);
    handler.ingest(signingAction());
    await expect(handler.execute("action-1")).rejects.toThrow("User rejected");
    expect(respond).not.toHaveBeenCalled();
    expect(sign).toHaveBeenCalledOnce();
  });

  it.each(["action", "request"])(
    "requires fresh preparation and approval for expired %s",
    async (expiry) => {
      const sign = vi.fn().mockResolvedValue(signed);
      const respond = vi.fn(acknowledge);
      const handler = new ActionHandler({ sign }, respond);
      const expired = signingAction();
      if (expiry === "action")
        expired.expires_at = Math.floor(Date.now() / 1000) - 1;
      else if (expired.request.type === "sign")
        expired.request.expiresAt = new Date(Date.now() - 1000).toISOString();
      handler.ingest(expired);
      expect(handler.canExecute("action-1")).toBe(false);
      expect(() => handler.execute("action-1")).toThrow(
        "Prepare a new request",
      );
      expect(sign).not.toHaveBeenCalled();
      expect(respond).not.toHaveBeenCalled();
      handler.ingest(signingAction({ id: "fresh-action", revision: 1 }));
      expect(sign).not.toHaveBeenCalled();
      await handler.execute("fresh-action");
      expect(sign).toHaveBeenCalledOnce();
    },
  );

  it.each(["expired", "superseded", "aborted"])(
    "discards a signature when the approval is %s during the prompt",
    async (reason) => {
      let resolve!: (
        result: Extract<ActionResult, { status: "signed" }>,
      ) => void;
      const sign = vi.fn(
        () =>
          new Promise<Extract<ActionResult, { status: "signed" }>>((done) => {
            resolve = done;
          }),
      );
      const respond = vi.fn(acknowledge);
      const handler = new ActionHandler({ sign }, respond);
      const start = Date.now();
      handler.ingest(
        signingAction({ expires_at: Math.floor(start / 1000) + 60 }),
      );
      const pending = handler.execute("action-1");
      if (reason === "expired")
        vi.spyOn(Date, "now").mockReturnValue(start + 120_000);
      if (reason === "superseded")
        handler.ingest(signingAction({ revision: 2 }));
      if (reason === "aborted") handler.abort("action-1");
      resolve(signed as Extract<ActionResult, { status: "signed" }>);
      await expect(pending).rejects.toThrow(
        reason === "expired" ? "expired" : "Action changed",
      );
      expect(respond).not.toHaveBeenCalled();
      if (reason === "expired")
        await expect(handler.retry("action-1")).rejects.toThrow("expired");
      expect(respond).not.toHaveBeenCalled();
      expect(sign).toHaveBeenCalledOnce();
    },
  );
});
