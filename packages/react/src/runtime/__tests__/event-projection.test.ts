import { describe, expect, it } from "vitest";
import type { Event } from "@aomi-labs/client";

import {
  logicalTurnRunning,
  projectAssistantMessages,
  projectRuntimeMessages,
  walletContinuationPending,
} from "../utils";
import {
  callbackEvents,
  callbackCall,
  callbackRoot,
  callbackTurn,
} from "../../../../../tests/fixtures/commit-callback-events";
import { appendCapabilityHints } from "../capability-hints";

const meta = (
  sequence: number,
  type: Event["type"],
  turnId: string | null,
) => ({
  event_id: `event-${sequence}`,
  sequence,
  turn_id: turnId,
  occurred_at: 1_735_000_000_000 + sequence,
  type,
});

it("keeps an accepted optimistic turn running before its durable user event", () => {
  const events = callbackEvents;
  expect(
    logicalTurnRunning(
      events,
      projectAssistantMessages(events),
      "processing",
      false,
      "Proceed with the prepared pair",
    ),
  ).toBe(true);
  expect(
    logicalTurnRunning(
      events,
      projectAssistantMessages(events),
      "processing",
      false,
    ),
  ).toBe(false);
});

describe("projectAssistantMessages", () => {
  it("rehydrates the saved cross-turn wallet result as one call and settles its callback", () => {
    const projected = projectAssistantMessages(callbackEvents);
    const assistant = projected.find(
      (message) => message.id === `turn:${callbackRoot}`,
    )!;
    const parts = assistant.content as Array<{
      type: string;
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
    }>;
    expect(
      parts.filter((part) => part.toolCallId === callbackCall),
    ).toHaveLength(1);
    expect(
      parts.find((part) => part.toolCallId === callbackCall)?.result,
    ).toMatchObject({ status: "success" });
    expect(
      parts.filter((part) => part.toolName === "evm_stage_tx"),
    ).toHaveLength(3);
    expect(
      new Set(
        parts
          .filter((part) => part.type === "tool-call")
          .map((part) => part.toolCallId),
      ).size,
    ).toBe(parts.filter((part) => part.type === "tool-call").length);
    expect(logicalTurnRunning(callbackEvents, projected, "processing")).toBe(
      false,
    );
    const beforeComplete = callbackEvents.filter(
      (event) => event.sequence < 32,
    );
    expect(
      logicalTurnRunning(
        beforeComplete,
        projectAssistantMessages(beforeComplete),
        "complete",
      ),
    ).toBe(true);
    expect(
      projectAssistantMessages([
        ...callbackEvents,
        callbackEvents.find((event) => event.sequence === 15)!,
      ]),
    ).toEqual(projected);
  });

  it("does not stop a new active user turn when an older callback completes late", () => {
    const events: Event[] = [
      ...callbackEvents.filter((event) => event.sequence < 32),
      {
        ...meta(33, "message", "new-user-turn"),
        type: "message",
        sender: "user",
        content: "A new question",
      },
      {
        ...meta(34, "turn_state_changed", "new-user-turn"),
        type: "turn_state_changed",
        state: "processing",
      },
      {
        ...meta(35, "turn_state_changed", callbackTurn),
        type: "turn_state_changed",
        state: "complete",
      },
    ];
    expect(
      logicalTurnRunning(events, projectAssistantMessages(events), "complete"),
    ).toBe(true);
  });

  it("preserves a legacy inline call when a same-name typed call has no shared identity", () => {
    const events: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "legacy-read",
        tool_name: "read",
        tool_result: ["read", "{}"],
      },
      {
        ...meta(2, "tool_complete", "turn-1"),
        type: "tool_complete",
        id: "typed-read",
        call_id: "distinct-read",
        tool_name: "read",
        result: {},
      },
    ];
    expect(projectAssistantMessages(events)[0]?.content).toHaveLength(2);
  });

  it("keeps frontend capability hints out of optimistic and canonical user messages", () => {
    const hinted = appendCapabilityHints("swap one eth", {
      policy: "auto",
      resolvedMode: "direct",
      capabilities: [
        { kind: "skill", id: "uniswap" },
        { kind: "chain", id: "eip155:8453" },
      ],
    });

    expect(projectRuntimeMessages([], hinted)[0]).toMatchObject({
      content: [{ type: "text", text: "swap one eth" }],
      metadata: {
        custom: {
          aomiCapabilityHints: [
            { kind: "skill", id: "uniswap" },
            { kind: "chain", id: "eip155:8453" },
          ],
        },
      },
    });
    expect(
      projectAssistantMessages([
        {
          ...meta(1, "message", "turn-1"),
          type: "message",
          sender: "user",
          content: hinted,
          message_key: "user-1",
        },
      ])[0],
    ).toMatchObject({
      content: [{ type: "text", text: "swap one eth" }],
      metadata: {
        custom: {
          aomiCapabilityHints: [
            { kind: "skill", id: "uniswap" },
            { kind: "chain", id: "eip155:8453" },
          ],
        },
      },
    });
  });

  it("reconciles the optimistic user echo with the canonical event by id", () => {
    const optimistic = projectRuntimeMessages([], "hello");
    const canonical = projectRuntimeMessages([
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "user",
        content: "hello",
        message_key: "server-generated-id",
      },
    ]);

    expect(optimistic[0]).toMatchObject({
      id: "aomi-user-0",
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
    expect(canonical[0]).toMatchObject({
      id: optimistic[0]?.id,
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("projects one ordered turn without owning a second reducer", () => {
    const events: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "user",
        content: "swap",
        message_key: "user-1",
      },
      {
        ...meta(2, "tool_update", "turn-1"),
        type: "tool_update",
        id: "tool-1",
        call_id: "call-1",
        tool_name: "quote",
        result: { stage: "started" },
      },
      {
        ...meta(3, "tool_complete", "turn-1"),
        type: "tool_complete",
        id: "tool-1",
        call_id: "call-1",
        tool_name: "quote",
        result: { amount: "1" },
      },
      {
        ...meta(4, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "Done",
        message_key: "agent-1",
      },
    ];

    const projected = projectAssistantMessages(events);
    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ role: "user" });
    expect(projected[1]?.content).toMatchObject([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "quote",
        result: { amount: "1" },
      },
      { type: "text", text: "Done" },
    ]);
  });

  it("projects inline tool_result message events as tool parts", () => {
    // The recorder bridges inline tool steps as agent messages carrying the
    // [topic, json] tuple; the contract-typed events never arrive for them.
    const events: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "tool-step-1",
        tool_call_id: "call-balance-1",
        tool_name: "get_balance",
        tool_arguments: { owner: "vitalik.eth" },
        tool_result: ["Read vitalik.eth ETH balance", '{"balance_eth":"6.64"}'],
      },
      {
        ...meta(2, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "vitalik.eth holds 6.64 ETH",
        message_key: "agent-1",
      },
    ];

    expect(projectAssistantMessages(events)[0]?.content).toMatchObject([
      {
        type: "tool-call",
        toolCallId: "call-balance-1",
        toolName: "get_balance",
        args: { owner: "vitalik.eth" },
        result: { balance_eth: "6.64" },
      },
      { type: "text", text: "vitalik.eth holds 6.64 ETH" },
    ]);
  });

  it("keeps a durable wallet continuation in its originating assistant row", () => {
    const events: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "user",
        content: "Send the payment",
      },
      {
        ...meta(2, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "commit-step",
        tool_name: "evm_commit_txs",
        tool_result: [
          "Commit",
          JSON.stringify({
            commits: [
              { commit_id: "commit-1", batch: { batch_id: "batch-1" } },
            ],
          }),
        ],
      },
      {
        ...meta(3, "turn_state_changed", "turn-1"),
        type: "turn_state_changed",
        state: "complete",
      },
      {
        ...meta(4, "turn_state_changed", "broadcast-terminal:batch-1"),
        type: "turn_state_changed",
        state: "processing",
      },
      {
        ...meta(5, "message", "broadcast-terminal:batch-1"),
        type: "message",
        sender: "agent",
        content: "Payment confirmed.",
        message_key: "broadcast-terminal:batch-1:response",
        is_streaming: true,
      },
      {
        ...meta(6, "turn_state_changed", "broadcast-terminal:batch-1"),
        type: "turn_state_changed",
        state: "complete",
      },
    ];

    const beforeCallback = projectAssistantMessages(events.slice(0, 3));
    const streaming = projectAssistantMessages(events.slice(0, 5));
    const complete = projectAssistantMessages(events);
    const live = projectRuntimeMessages(events.slice(0, 4), undefined, [
      events[4] as Extract<Event, { type: "message" }>,
    ]);
    expect(streaming).toHaveLength(2);
    expect(live).toHaveLength(2);
    expect(complete).toHaveLength(2);
    expect(streaming[1]?.id).toBe(beforeCallback[1]?.id);
    expect(live[1]?.id).toBe(beforeCallback[1]?.id);
    expect(streaming[1]?.metadata?.custom).toMatchObject({
      aomiFinalAnswerStartIndex: 1,
    });
    expect(live[1]?.metadata?.custom).toMatchObject({
      aomiFinalAnswerStartIndex: 1,
    });
    expect(complete[1]?.content).toMatchObject([
      { type: "tool-call", toolName: "evm_commit_txs" },
      { type: "text", text: "Payment confirmed." },
    ]);

    const following = projectAssistantMessages([
      ...events,
      {
        ...meta(7, "message", "turn-2"),
        type: "message",
        sender: "user",
        content: "Another request",
      },
      {
        ...meta(8, "message", "turn-2"),
        type: "message",
        sender: "agent",
        content: "Another answer",
      },
    ]);
    expect(following).toHaveLength(4);
    expect(following[1]?.id).toBe(beforeCallback[1]?.id);
    expect(following[3]?.content).toEqual([
      { type: "text", text: "Another answer" },
    ]);
  });

  it("keeps a two-transaction batch open through wallet receipts and settles on its final callback", () => {
    // The wire emits one admission with two CommitViews, then one terminal
    // ToolCompletion per member. Only the batch id owns the model callback.
    const batchId = "batch-1";
    const callbackId = `broadcast-terminal:${batchId}`;
    const admission = {
      commits: [
        { commit_id: "commit-1", batch: { batch_id: batchId } },
        { commit_id: "commit-2", batch: { batch_id: batchId } },
      ],
    };
    const events: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "user",
        content: "Approve and supply",
      },
      {
        ...meta(2, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "commit-admission",
        tool_call_id: "commit-call",
        tool_name: "evm_commit_txs",
        tool_result: ["Commit", JSON.stringify(admission)],
      },
      {
        ...meta(3, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "Your wallet approval is required.",
        message_key: "turn-1:note",
      },
      {
        ...meta(4, "turn_state_changed", "turn-1"),
        type: "turn_state_changed",
        state: "complete",
      },
      ...["commit-1", "commit-2"].map(
        (commitId, index) =>
          ({
            ...meta(5 + index, "tool_complete", "turn-1"),
            type: "tool_complete",
            id: `receipt-${index}`,
            call_id: "commit-call",
            tool_name: "evm_commit_txs",
            result: {
              status: "success",
              commit_id: commitId,
              identifier: { kind: "hash", value: `0x${index}` },
              pending_ids: [{ id: index + 1, chain: "evm" }],
            },
          }) as Event,
      ),
      {
        ...meta(7, "turn_state_changed", callbackId),
        type: "turn_state_changed",
        state: "processing",
      },
      {
        ...meta(8, "message", callbackId),
        type: "message",
        sender: "agent",
        content: "Both transactions succeeded.",
        message_key: `${callbackId}:response`,
        is_streaming: false,
      },
      {
        ...meta(9, "turn_state_changed", callbackId),
        type: "turn_state_changed",
        state: "complete",
      },
    ];

    for (const count of [4, 6, 7, 8]) {
      const phase = events.slice(0, count);
      const assistant = projectAssistantMessages(phase)[1];
      const ids = (
        assistant?.metadata?.custom as
          | { aomiContinuationTurnIds?: string[] }
          | undefined
      )?.aomiContinuationTurnIds;
      expect(ids).toEqual([callbackId]);
      expect(walletContinuationPending(ids ?? [], phase)).toBe(true);
      expect(
        logicalTurnRunning(phase, projectAssistantMessages(phase), "complete"),
      ).toBe(true);
    }

    const projected = projectAssistantMessages(events);
    const assistant = projected[1];
    const ids = (
      assistant?.metadata?.custom as
        | { aomiContinuationTurnIds?: string[] }
        | undefined
    )?.aomiContinuationTurnIds;
    expect(projected).toHaveLength(2);
    expect(assistant).toMatchObject({
      id: "turn:turn-1",
      metadata: {
        custom: {
          aomiContinuationTurnIds: [callbackId],
          aomiFinalAnswerStartIndex: 2,
        },
      },
    });
    expect(walletContinuationPending(ids ?? [], events)).toBe(false);
    expect(logicalTurnRunning(events, projected, "complete")).toBe(false);
  });

  it("settles a completed callback without a response message", () => {
    const callbackId = "broadcast-terminal:batch-1";
    expect(
      walletContinuationPending(
        [callbackId],
        [
          {
            ...meta(1, "turn_state_changed", callbackId),
            type: "turn_state_changed",
            state: "complete",
          },
        ],
      ),
    ).toBe(false);
  });

  it("groups a namespaced typed commit callback after a later user turn", () => {
    const projected = projectAssistantMessages([
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "user",
        content: "First request",
      },
      {
        ...meta(2, "tool_complete", "turn-1"),
        type: "tool_complete",
        id: "tool-1",
        call_id: "commit-call",
        tool_name: "wallet::svm_commit_tx",
        result: { commits: [{ commit_id: "commit-1" }] },
      },
      {
        ...meta(3, "message", "turn-2"),
        type: "message",
        sender: "user",
        content: "Second request",
      },
      {
        ...meta(4, "message", "turn-2"),
        type: "message",
        sender: "agent",
        content: "Second answer",
      },
      {
        ...meta(5, "message", "broadcast-terminal:commit-1"),
        type: "message",
        sender: "agent",
        content: "First operation finished",
        message_key: "broadcast-terminal:commit-1:response",
      },
    ]);

    expect(projected).toHaveLength(4);
    expect(projected[1]).toMatchObject({
      id: "turn:turn-1",
      content: [
        { type: "tool-call", toolName: "wallet::svm_commit_tx" },
        { type: "text", text: "First operation finished" },
      ],
      metadata: { custom: { aomiFinalAnswerStartIndex: 1 } },
    });
    expect(projected[3]).toMatchObject({ id: "turn:turn-2" });
  });

  it("keeps nested durable callbacks in the original turn with only the final response outside the trace", () => {
    const events: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "user",
        content: "Complete both payments",
      },
      {
        ...meta(2, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "commit-a",
        tool_name: "evm_commit_txs",
        tool_result: [
          "Commit",
          JSON.stringify({
            commits: [{ commit_id: "a", batch: { batch_id: "batch-a" } }],
          }),
        ],
      },
      {
        ...meta(3, "turn_state_changed", "turn-1"),
        type: "turn_state_changed",
        state: "complete",
      },
      {
        ...meta(4, "turn_state_changed", "broadcast-terminal:batch-a"),
        type: "turn_state_changed",
        state: "processing",
      },
      {
        ...meta(5, "message", "broadcast-terminal:batch-a"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "broadcast-terminal:batch-a:trace:commit-b",
        tool_name: "evm_commit_txs",
        tool_result: [
          "Commit",
          JSON.stringify({
            commits: [{ commit_id: "b", batch: { batch_id: "batch-b" } }],
          }),
        ],
      },
      {
        ...meta(6, "message", "broadcast-terminal:batch-a"),
        type: "message",
        sender: "agent",
        content: "The first payment finished; approve the second.",
        message_key: "broadcast-terminal:batch-a:trace:note-a",
      },
      {
        ...meta(7, "turn_state_changed", "broadcast-terminal:batch-a"),
        type: "turn_state_changed",
        state: "complete",
      },
      {
        ...meta(8, "turn_state_changed", "broadcast-terminal:batch-b"),
        type: "turn_state_changed",
        state: "processing",
      },
      {
        ...meta(9, "message", "broadcast-terminal:batch-b"),
        type: "message",
        sender: "agent",
        content: "Both payments finished.",
        message_key: "broadcast-terminal:batch-b:response",
      },
      {
        ...meta(10, "turn_state_changed", "broadcast-terminal:batch-b"),
        type: "turn_state_changed",
        state: "complete",
      },
    ];
    const awaitingSecondCallback = projectAssistantMessages(events.slice(0, 8));
    const streamingSecondCallback = projectRuntimeMessages(
      events.slice(0, 8),
      undefined,
      [events[8] as Extract<Event, { type: "message" }>],
    );
    const projected = projectAssistantMessages(events);
    expect(awaitingSecondCallback).toHaveLength(2);
    expect(streamingSecondCallback).toHaveLength(2);
    expect(streamingSecondCallback[1]?.metadata?.custom).toMatchObject({
      aomiFinalAnswerStartIndex: 3,
    });
    expect(awaitingSecondCallback[1]?.metadata?.custom).toMatchObject({
      aomiContinuationTurnIds: [
        "broadcast-terminal:batch-a",
        "broadcast-terminal:batch-b",
      ],
    });
    expect(awaitingSecondCallback[1]?.metadata?.custom).not.toHaveProperty(
      "aomiFinalAnswerStartIndex",
    );
    expect(projected).toHaveLength(2);
    expect(projected[1]).toMatchObject({
      id: "turn:turn-1",
      content: [
        { type: "tool-call", toolName: "evm_commit_txs" },
        { type: "tool-call", toolName: "evm_commit_txs" },
        {
          type: "text",
          text: "The first payment finished; approve the second.",
        },
        { type: "text", text: "Both payments finished." },
      ],
      metadata: {
        custom: {
          aomiFinalAnswerStartIndex: 3,
          aomiContinuationTurnIds: [
            "broadcast-terminal:batch-a",
            "broadcast-terminal:batch-b",
          ],
        },
      },
    });
  });

  it("keeps malformed cyclic callback ancestry in separate rows", () => {
    const projected = projectAssistantMessages([
      {
        ...meta(1, "tool_complete", "broadcast-terminal:a"),
        type: "tool_complete",
        id: "tool-b",
        call_id: "call-b",
        tool_name: "evm_commit_txs",
        result: { commits: [{ commit_id: "b" }] },
      },
      {
        ...meta(2, "tool_complete", "broadcast-terminal:b"),
        type: "tool_complete",
        id: "tool-a",
        call_id: "call-a",
        tool_name: "evm_commit_txs",
        result: { commits: [{ commit_id: "a" }] },
      },
    ]);

    expect(projected.map((message) => message.id)).toEqual([
      "turn:broadcast-terminal:a",
      "turn:broadcast-terminal:b",
    ]);
  });

  it("groups legacy null-turn tools and answers by their preceding user message", () => {
    const events: Event[] = [
      {
        ...meta(1, "message", null),
        type: "message",
        sender: "user",
        content: "first",
      },
      {
        ...meta(2, "message", null),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "first-tool-1",
        tool_name: "search",
        tool_result: ["Search", '{"matches":2}'],
      },
      {
        ...meta(3, "message", null),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "first-tool-2",
        tool_name: "inspect",
        tool_result: ["Inspect", '{"valid":true}'],
      },
      {
        ...meta(4, "message", null),
        type: "message",
        sender: "agent",
        content: "First answer",
      },
      {
        ...meta(5, "message", null),
        type: "message",
        sender: "user",
        content: "second",
      },
      {
        ...meta(6, "message", null),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "second-tool",
        tool_name: "quote",
        tool_result: ["Quote", '{"price":"1"}'],
      },
      {
        ...meta(7, "message", null),
        type: "message",
        sender: "agent",
        content: "Second answer",
      },
    ];

    const firstPage = projectAssistantMessages(events.slice(0, 4));
    const projected = projectAssistantMessages(events);

    expect(projected).toHaveLength(4);
    expect(projected[1]).toMatchObject({
      id: firstPage[1]?.id,
      role: "assistant",
      content: [
        { type: "tool-call", toolName: "search", result: { matches: 2 } },
        { type: "tool-call", toolName: "inspect", result: { valid: true } },
        { type: "text", text: "First answer" },
      ],
    });
    expect(projected[3]).toMatchObject({
      role: "assistant",
      content: [
        { type: "tool-call", toolName: "quote", result: { price: "1" } },
        { type: "text", text: "Second answer" },
      ],
    });
  });

  it("keeps explicit turn ids authoritative and deduplicates null-turn typed completions", () => {
    const events: Event[] = [
      {
        ...meta(1, "message", "canonical-turn"),
        type: "message",
        sender: "agent",
        content: "Canonical",
      },
      {
        ...meta(2, "message", null),
        type: "message",
        sender: "user",
        content: "legacy",
      },
      {
        ...meta(3, "message", null),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "inline-quote",
        tool_call_id: "typed-quote",
        tool_name: "quote",
        tool_result: ["Quote", '{"price":"old"}'],
      },
      {
        ...meta(4, "tool_complete", null),
        type: "tool_complete",
        id: "quote",
        call_id: "typed-quote",
        tool_name: "quote",
        result: { price: "new" },
      },
    ];

    const projected = projectAssistantMessages(events);
    expect(projected[0]?.id).toBe("turn:canonical-turn");
    expect(projected[2]?.content).toEqual([
      {
        type: "tool-call",
        toolCallId: "typed-quote",
        toolName: "quote",
        args: undefined,
        result: { price: "new" },
      },
    ]);
  });

  it("starts a new legacy group after a user message with an explicit turn id", () => {
    const projected = projectAssistantMessages([
      {
        ...meta(1, "message", null),
        type: "message",
        sender: "user",
        content: "legacy",
      },
      {
        ...meta(2, "message", null),
        type: "message",
        sender: "agent",
        content: "Legacy answer",
      },
      {
        ...meta(3, "message", "canonical-turn"),
        type: "message",
        sender: "user",
        content: "canonical request",
      },
      {
        ...meta(4, "message", null),
        type: "message",
        sender: "agent",
        content: "Imported answer after canonical user",
      },
    ]);

    expect(projected).toHaveLength(4);
    expect(projected[1]?.id).toBe("turn:legacy:event-1");
    expect(projected[3]?.id).toBe("turn:legacy:event-3");
  });

  it("keeps an inline tool's trace when a different tool completed typed in the same turn", () => {
    const events: Event[] = [
      {
        ...meta(1, "tool_complete", "turn-1"),
        type: "tool_complete",
        id: "tool-1",
        call_id: "call-quote",
        tool_name: "get_quote",
        result: { price: "2437" },
      },
      {
        ...meta(2, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "tool-step-balance",
        tool_name: "get_balance",
        tool_result: ["Read balance", '{"balance_eth":"6.64"}'],
      },
      {
        ...meta(3, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "Done",
        message_key: "agent-1",
      },
    ];

    expect(projectAssistantMessages(events)[0]?.content).toMatchObject([
      {
        type: "tool-call",
        toolCallId: "call-quote",
        toolName: "get_quote",
      },
      {
        type: "tool-call",
        toolCallId: "inline:tool-step-balance",
        toolName: "get_balance",
        result: { balance_eth: "6.64" },
      },
      { type: "text", text: "Done" },
    ]);
  });

  it("prefers typed tool completion when both wire shapes are present", () => {
    const events: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "",
        message_key: "tool-step-1",
        tool_call_id: "call-1",
        tool_name: "get_balance",
        tool_result: ["Read balance", '{"balance_eth":"6.64"}'],
      },
      {
        ...meta(2, "tool_complete", "turn-1"),
        type: "tool_complete",
        id: "tool-1",
        call_id: "call-1",
        tool_name: "get_balance",
        result: { balance_eth: "6.64" },
      },
      {
        ...meta(3, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "Done",
        message_key: "agent-1",
      },
    ];

    expect(projectAssistantMessages(events)[0]?.content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "get_balance",
        args: undefined,
        result: { balance_eth: "6.64" },
      },
      { type: "text", text: "Done" },
    ]);
  });

  it("replaces streaming message revisions by message key", () => {
    const messages: Event[] = [
      {
        ...meta(1, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "Do",
        message_key: "agent-1",
        is_streaming: true,
      },
      {
        ...meta(2, "message", "turn-1"),
        type: "message",
        sender: "agent",
        content: "Done",
        message_key: "agent-1",
        is_streaming: false,
      },
    ];

    expect(projectAssistantMessages(messages)[0]?.content).toEqual([
      { type: "text", text: "Done" },
    ]);
  });
});
