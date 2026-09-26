import { describe, expect, it } from "vitest";
import {
  parseResourceResult,
  resourceResultForCall,
} from "../src/resources/result";

import type { Event } from "../src/agent/types";

const result = {
  resource: { uri: "aomi://local/results/opaque-id", kind: "data.json@1" },
  summary: { action: "Swap USDC", amount: "25" },
  resources: {
    transactions: [
      { uri: "aomi://local/transactions/tx-id", kind: "evm.transaction@1" },
    ],
  },
};

describe("resource result boundary", () => {
  it("preserves compact summary and ordered named links through history serialization", () => {
    expect(parseResourceResult(JSON.stringify(result))).toEqual(result);
  });

  it.each([
    { uri: result.resource.uri },
    {
      summary: result.summary,
      resource: { uri: "https://other.example/payload", kind: "data.json@1" },
    },
    { ...result, resources: { value: { uri: result.resource.uri } } },
    {
      ...result,
      resources: {
        value: [result.resource, { uri: "aomi://local/results/other" }],
      },
    },
    { ...result, resource: { ...result.resource, name: 2 } },
    "plain output",
  ])("does not promote arbitrary or malformed data to resources", (value) => {
    expect(parseResourceResult(value)).toBeUndefined();
  });
});

const meta = {
  event_id: "event",
  sequence: 1,
  turn_id: "turn",
  occurred_at: 1,
};

it("selects only a declared call projection while preserving full native result", () => {
  const raw = {
    pending_tx_id: 7,
    to: "recipient",
    data: "0x" + "ab".repeat(4096),
  };
  const event: Event = {
    ...meta,
    type: "tool_complete",
    id: "stage",
    call_id: "stage",
    tool_name: "evm_stage_tx",
    result: raw,
    model_output: result,
  };
  expect(resourceResultForCall([event], "stage")).toEqual(result);
  expect(event.result).toBe(raw);
  expect(resourceResultForCall([event], "other")).toBeUndefined();
  const inline: Event = {
    ...meta,
    type: "message",
    sender: "agent",
    content: "",
    tool_call_id: "stage",
    tool_name: "evm_stage_tx",
    tool_result: ["evm_stage_tx", JSON.stringify(raw)],
    model_output: result,
  };
  expect(resourceResultForCall([inline], "stage")).toEqual(result);
  expect(JSON.parse(inline.tool_result![1])).toEqual(raw);
  expect(
    resourceResultForCall([{ ...inline, sender: "user" }], "stage"),
  ).toBeUndefined();
  expect(
    resourceResultForCall(
      [{ ...event, model_output: { data: result.resource.uri } }],
      "stage",
    ),
  ).toBeUndefined();
});
