import { describe, expect, it } from "vitest";

import type { Event, MessageEvent } from "../../src/agent/types";
import {
  countToolCalls,
  inlineToolResultFromMessage,
} from "../../src/cli/output";

const inlineToolMessage = {
  event_id: "event-tool",
  sequence: 2,
  turn_id: "turn-1",
  occurred_at: 1,
  type: "message",
  sender: "agent",
  content: "",
  tool_name: "get_account_info",
  tool_arguments: { address: "0x0000" },
  tool_result: ["Read balance", '{"balance_native":"1"}'],
} as MessageEvent;

describe("CLI tool output projection", () => {
  it("reads tool traces from today's message event wire shape", () => {
    expect(inlineToolResultFromMessage(inlineToolMessage)).toEqual({
      name: "get_account_info",
      result: '{"balance_native":"1"}',
      turnId: "turn-1",
    });
  });

  it("does not double-count compatibility messages after typed tool events arrive", () => {
    const typedTool = {
      event_id: "event-typed-tool",
      sequence: 3,
      turn_id: "turn-1",
      occurred_at: 2,
      type: "tool_complete",
      id: "tool-1",
      tool_name: "get_account_info",
      result: { balance_native: "1" },
    } as Event;

    expect(countToolCalls([inlineToolMessage as Event, typedTool])).toBe(1);
  });
});
