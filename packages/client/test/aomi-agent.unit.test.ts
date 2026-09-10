import { describe, expect, it, vi } from "vitest";

import { Aomi, AgentRun } from "../src";
import type { Action, EventPage } from "../src";

const occurredAt = Date.parse("2026-08-25T00:00:00Z");

function evmAction(overrides: Partial<Action> = {}): Action {
  return {
    type: "action",
    event_id: "event-action-1",
    sequence: 2,
    turn_id: "turn-1",
    occurred_at: occurredAt,
    id: "action-1",
    revision: 1,
    state: "completed",
    request: {
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0",
          data: "0x1234",
          label: "Supply",
          kind: "supply",
        },
      ],
    },
    result: {
      status: "submitted",
      legs: [
        { id: "leg_1", status: "submitted", transactionId: "0xsubmitted" },
      ],
    },
    created_at: occurredAt,
    expires_at: null,
    ...overrides,
  };
}

function page(
  sessionId: string,
  events: EventPage["events"],
  cursor = `cursor-${events.at(-1)?.sequence ?? 0}`,
): EventPage {
  return { session_id: sessionId, cursor, events, has_more: false };
}

describe("high-level Aomi Agent", () => {
  it("is awaitable and exposes canonical Action and completion events", async () => {
    const completeAction = evmAction();
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        page("agent-1", [
          {
            type: "message",
            event_id: "event-message-1",
            sequence: 1,
            turn_id: "turn-1",
            occurred_at: occurredAt,
            sender: "agent",
            content: "Done",
            is_streaming: false,
          },
          completeAction,
          {
            type: "title_changed",
            event_id: "event-title-1",
            sequence: 3,
            turn_id: "turn-1",
            occurred_at: occurredAt,
            title: "Aave supply",
          },
          {
            type: "turn_state_changed",
            event_id: "event-turn-1",
            sequence: 4,
            turn_id: "turn-1",
            occurred_at: occurredAt,
            state: "complete",
          },
        ]),
      ),
    );
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      fetch,
      guest: false,
    });

    const run = aomi.agent.run("Supply 100 USDC to Aave", {
      sessionId: "agent-1",
      userState: {
        connection: { is_connected: true },
        evm: {
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chain_id: 8453,
        },
      },
    });
    const actions = vi.fn();
    const completed = vi.fn();
    run.on("action", actions);
    run.on("completed", completed);

    const result = await run;

    expect(run).toBeInstanceOf(AgentRun);
    expect(result).toMatchObject({
      sessionId: "agent-1",
      title: "Aave supply",
      actions: [{ id: "action-1", state: "completed", revision: 1 }],
    });
    expect(actions).toHaveBeenCalledWith(completeAction);
    expect(completed).toHaveBeenCalledWith(result);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({
      sessionId: "agent-1",
      message: "Supply 100 USDC to Aave",
      userState: {
        connection: { is_connected: true },
        evm: {
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chain_id: 8453,
        },
      },
    });
    expect(
      JSON.parse(fetch.mock.calls[0][1].body as string),
    ).not.toHaveProperty("mode");
    expect(
      JSON.parse(fetch.mock.calls[0][1].body as string),
    ).not.toHaveProperty("app");
  });

  it("executes a pending Action explicitly through the session handler", async () => {
    const pending = evmAction({
      id: "wallet-action",
      event_id: "event-action-pending",
      revision: 3,
      state: "pending",
      result: null,
    });
    const submitted = evmAction({
      ...pending,
      event_id: "event-action-submitted",
      sequence: 4,
      revision: 4,
      state: "submitted",
      result: {
        status: "submitted",
        legs: [
          { id: "leg_1", status: "submitted", transactionId: "0xagenttx" },
        ],
      },
    });
    const sendCalls = vi.fn().mockResolvedValue({ hashes: ["0xagenttx"] });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/agent/chat") && init?.method === "POST") {
        return Response.json(
          page("agent-wallet", [
            {
              type: "turn_state_changed",
              event_id: "event-processing",
              sequence: 1,
              turn_id: "turn-1",
              occurred_at: occurredAt,
              state: "processing",
            },
            pending,
            {
              type: "turn_state_changed",
              event_id: "event-awaiting",
              sequence: 3,
              turn_id: "turn-1",
              occurred_at: occurredAt,
              state: "awaiting_action",
            },
          ]),
        );
      }
      if (url.includes("/actions/wallet-action/result")) {
        return Response.json({ action: submitted });
      }
      if (url.includes("/v1/agent/chat/agent-wallet")) {
        return Response.json(
          page("agent-wallet", [
            {
              type: "message",
              event_id: "event-message-complete",
              sequence: 5,
              turn_id: "turn-1",
              occurred_at: occurredAt,
              sender: "agent",
              content: "Executed",
              is_streaming: false,
            },
            {
              type: "turn_state_changed",
              event_id: "event-complete",
              sequence: 6,
              turn_id: "turn-1",
              occurred_at: occurredAt,
              state: "complete",
            },
            {
              type: "title_changed",
              event_id: "event-title",
              sequence: 7,
              turn_id: "turn-1",
              occurred_at: occurredAt,
              title: "Execute action",
            },
          ]),
        );
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const wallets = {
      evm: {
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chainId: 8453,
        sendCalls,
      },
    };
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
      wallet: wallets,
    });
    expect(aomi.wallet).toBe(wallets);
    const run = aomi.agent.run("Execute", {
      sessionId: "agent-wallet",
      pollIntervalMs: 1,
    });
    const actions = vi.fn();
    run.on("action", (action) => {
      actions(action);
      if (action.state === "pending") {
        void run.session.actions.execute(action.id);
      }
    });

    const result = await run.result();

    expect(result.sessionId).toBe("agent-wallet");
    expect(actions).toHaveBeenCalledWith(pending);
    expect(actions).toHaveBeenCalledWith(submitted);
    expect(sendCalls).toHaveBeenCalledWith({
      chainId: 8453,
      calls: [
        {
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0",
          data: "0x1234",
        },
      ],
    });
    const resolution = fetch.mock.calls.find(([url]) =>
      url.includes("/actions/wallet-action/result"),
    );
    expect(JSON.parse(resolution?.[1]?.body as string)).toEqual({
      revision: 3,
      result: {
        status: "submitted",
        legs: [
          {
            id: "leg_1",
            status: "submitted",
            transactionId: "0xagenttx",
          },
        ],
      },
    });
    const start = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string);
    expect(start.userState).toEqual({
      connection: { is_connected: true },
      evm: {
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chain_id: 8453,
      },
    });
  });
});
