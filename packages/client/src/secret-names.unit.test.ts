import { describe, expect, it } from "vitest";
import { secretNamesFrom } from "./client";
describe("secretNamesFrom", () => {
  it("reads the client-scoped names and accepts an empty response", () => {
    expect(
      secretNamesFrom({ names: ["BYOK:openai", "PAYMENT:tempo"] }),
    ).toEqual(["BYOK:openai", "PAYMENT:tempo"]);
    expect(secretNamesFrom({})).toEqual([]);
  });
});
