import { describe, expect, it } from "vitest";
import type { Event } from "@aomi-labs/client";

import { projectAssistantMessages, projectRuntimeMessages } from "../utils";
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

describe("projectAssistantMessages", () => {
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
