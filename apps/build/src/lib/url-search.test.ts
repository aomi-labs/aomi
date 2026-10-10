import { describe, expect, it } from "vitest";
import { parseUrlSearch, stringifyUrlSearch } from "./url-search";

describe("Build URL search contract", () => {
  it("preserves textual numbers, booleans, JSON-looking values and repeated keys", () => {
    const search =
      "?platform=123&enabled=false&state=%7B%7D&tab=logs&tab=usage";
    const parsed = parseUrlSearch(search);
    expect(parsed).toEqual({
      platform: "123",
      enabled: "false",
      state: "{}",
      tab: ["logs", "usage"],
    });
    expect(parseUrlSearch(stringifyUrlSearch(parsed))).toEqual(parsed);
  });

  it("does not treat prototype names as inherited values", () => {
    const parsed = parseUrlSearch("?__proto__=private&constructor=safe");
    expect(parsed.__proto__).toBe("private");
    expect(parsed.constructor).toBe("safe");
  });
});
