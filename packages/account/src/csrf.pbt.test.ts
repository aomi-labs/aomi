import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { cookieWriteAllowed } from "@aomi-labs/account/csrf";

describe("cookieWriteAllowed — property-based", () => {
  it("accepts requests matching the request origin", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "https://portal.aomi.dev",
          "https://portal.aomi.dev/",
          "https://portal.aomi.dev/some/path?q=1",
        ),
        (url) => {
          const req = new Request("https://portal.aomi.dev/api/account", {
            method: "POST",
            headers: { origin: url },
          });
          expect(cookieWriteAllowed(req)).toBe(true);
        },
      ),
      { numRuns: 10 },
    );
  });

  it("rejects requests from non-matching origins", () => {
    fc.assert(
      fc.property(
        fc.domain().filter((d) => d !== "portal.aomi.dev"),
        (domain) => {
          const url = `https://${domain}/`;
          const req = new Request("https://portal.aomi.dev/api/account", {
            method: "POST",
            headers: { origin: url },
          });
          expect(cookieWriteAllowed(req)).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("rejects requests with no origin header", () => {
    const req = new Request("https://portal.aomi.dev", { method: "POST" });
    expect(cookieWriteAllowed(req)).toBe(false);
  });
});
