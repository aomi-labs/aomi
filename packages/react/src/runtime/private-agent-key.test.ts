import { expect, it } from "vitest";
import { appendCapabilityHints } from "@aomi-labs/client";
import { privateAgentKey } from "./private-agent-key";

const keys = new Map<string, string>([
  ["publisher/one", "one"],
  ["publisher/two", "two"],
]);
const slug = (id: number) =>
  `publisher/${({ 7: "one", 8: "two" } as Record<number, string>)[id] ?? id}`;
const getKey = (id: string) => keys.get(id);
const message = (...ids: number[]) =>
  appendCapabilityHints("Hello", {
    capabilities: ids.map((id) => ({ kind: "agent", id: `agent:${slug(id)}` })),
  });

it("uses only the explicitly mentioned private agent's key in Auto", () => {
  expect(privateAgentKey({ mode: "auto" }, message(7), getKey)).toBe("one");
  expect(privateAgentKey({ mode: "auto" }, message(8), getKey)).toBe("two");
  expect(privateAgentKey({ mode: "auto" }, message(9), getKey)).toBeUndefined();
  expect(
    privateAgentKey({ mode: "auto" }, "Public chat", getKey),
  ).toBeUndefined();
  expect(privateAgentKey({ mode: "auto" }, message(7, 7), getKey)).toBe("one");
});
it("does not let mentions override a fixed Direct target", () => {
  expect(
    privateAgentKey({ mode: "direct", agent: slug(7) }, message(8), getKey),
  ).toBe("one");
  expect(
    privateAgentKey({ mode: "direct", agent: slug(9) }, message(7), getKey),
  ).toBeUndefined();
});
it("rejects two private agents instead of choosing an unrelated credential", () => {
  expect(() =>
    privateAgentKey({ mode: "auto" }, message(7, 8), getKey),
  ).toThrow("Choose one private agent per message");
});
it("still asks for one agent when a second private mention has no stored key", () => {
  const isPrivate = (id: string) => id === slug(9);
  expect(() =>
    privateAgentKey({ mode: "auto" }, message(7, 9), getKey, isPrivate),
  ).toThrow("Choose one private agent per message");
  expect(
    privateAgentKey({ mode: "auto" }, message(7, 10), getKey, isPrivate),
  ).toBe("one");
});
