import { expect, it } from "vitest";
import { appendCapabilityHints } from "./capability-hints";
import { privateAppKey } from "./private-app-key";

const keys = new Map<string | number, string>([
  [7, "one"],
  [8, "two"],
]);
const getKey = (id: string | number) => keys.get(Number(id));
const message = (...ids: number[]) =>
  appendCapabilityHints("Hello", {
    capabilities: ids.map((id) => ({ kind: "app", id: `application:${id}` })),
  });

it("uses only the explicitly mentioned private app's key in Auto", () => {
  expect(privateAppKey({ mode: "auto" }, message(7), getKey)).toBe("one");
  expect(privateAppKey({ mode: "auto" }, message(8), getKey)).toBe("two");
  expect(privateAppKey({ mode: "auto" }, message(9), getKey)).toBeUndefined();
  expect(
    privateAppKey({ mode: "auto" }, "Public chat", getKey),
  ).toBeUndefined();
  expect(privateAppKey({ mode: "auto" }, message(7, 7), getKey)).toBe("one");
});
it("does not let mentions override a fixed Direct target", () => {
  expect(
    privateAppKey({ mode: "direct", applicationId: 7 }, message(8), getKey),
  ).toBe("one");
  expect(
    privateAppKey({ mode: "direct", applicationId: 9 }, message(7), getKey),
  ).toBeUndefined();
});
it("rejects two private apps instead of choosing an unrelated credential", () => {
  expect(() => privateAppKey({ mode: "auto" }, message(7, 8), getKey)).toThrow(
    "Choose one private app per message",
  );
});
it("still asks for one app when a second private mention has no stored key", () => {
  const isPrivate = (id: string) => id === "9";
  expect(() =>
    privateAppKey({ mode: "auto" }, message(7, 9), getKey, isPrivate),
  ).toThrow("Choose one private app per message");
  expect(
    privateAppKey({ mode: "auto" }, message(7, 10), getKey, isPrivate),
  ).toBe("one");
});
