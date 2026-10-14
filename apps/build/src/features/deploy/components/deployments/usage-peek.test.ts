import { describe, expect, it } from "vitest";
import { formatCompactCount, summarizeProjectUsage } from "./usage-peek";

describe("summarizeProjectUsage", () => {
  it("totals credits and tokens and builds a spark", () => {
    const peek = summarizeProjectUsage({
      daily: [
        {
          periodUtcDay: "2026-07-11",
          creditsUsed: 1,
          inputTokens: 100,
          outputTokens: 50,
        },
        {
          periodUtcDay: "2026-07-12",
          creditsUsed: 3,
          inputTokens: 200,
          outputTokens: 50,
        },
        {
          periodUtcDay: "2026-07-12",
          creditsUsed: 1,
          inputTokens: 0,
          outputTokens: 0,
        },
      ],
    });
    expect(peek.available).toBe(true);
    expect(peek.creditsUsed).toBe(5);
    expect(peek.tokens).toBe(400);
    expect(peek.dayCount).toBe(2);
    expect(peek.spark).toEqual([0.25, 1]);
  });

  it("marks null payload unavailable", () => {
    expect(summarizeProjectUsage(null).available).toBe(false);
  });
});

describe("formatCompactCount", () => {
  it("formats compact magnitudes", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(42)).toBe("42");
    expect(formatCompactCount(1250)).toBe("1.3k");
    expect(formatCompactCount(12_500)).toBe("13k");
  });
});
