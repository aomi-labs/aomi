import { describe, expect, it } from "vitest";

import { secretNamesFrom } from "../src/client";

/**
 * This client ships ahead of the backend, and a browser tab can be cached
 * across the cutover, so both shapes have to read correctly from the same
 * build. Per-user app secrets are gone (issue #990) — an application's
 * Environment belongs to its Builder — but a backend that predates that still
 * answers `by_app`.
 */
describe("secretNamesFrom", () => {
  it("reads the flat names list from a current backend", () => {
    expect(secretNamesFrom({ names: ["BYOK:openai", "PAYMENT:tempo"] })).toEqual(
      ["BYOK:openai", "PAYMENT:tempo"],
    );
  });

  it("flattens the retired by_app shape from an older backend", () => {
    expect(
      secretNamesFrom({
        by_app: { "somm-agent": ["SOMM_API_KEY"], other: ["OTHER_KEY"] },
      }),
    ).toEqual(["SOMM_API_KEY", "OTHER_KEY"]);
  });

  it("prefers names when the cutover backend sends both", () => {
    // The backend keeps an empty by_app beside names for one release so a
    // pre-deploy tab does not throw on undefined; names is the real answer.
    expect(
      secretNamesFrom({ names: ["BYOK:openai"], by_app: {} }),
    ).toEqual(["BYOK:openai"]);
  });

  it("yields an empty list rather than throwing on an empty response", () => {
    expect(secretNamesFrom({})).toEqual([]);
  });
});
