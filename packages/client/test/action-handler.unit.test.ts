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
