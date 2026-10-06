import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./format-relative-time";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-13T15:00:00Z");

  it("formats recent and older windows", () => {
    expect(formatRelativeTime(now / 1000 - 10, now)).toBe("just now");
    expect(formatRelativeTime(now / 1000 - 120, now)).toBe("2m ago");
    expect(formatRelativeTime(now / 1000 - 7200, now)).toBe("2h ago");
    expect(formatRelativeTime(now / 1000 - 90000, now)).toBe("1d ago");
  });
});
