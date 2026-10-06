import { describe, expect, it } from "vitest";
import { shouldShowThreadLoadingSkeleton } from "./thread-loading";

describe("thread loading skeleton", () => {
  it("only shows the transcript skeleton while loading an empty thread", () => {
    expect(
      shouldShowThreadLoadingSkeleton({
        isLoading: true,
        messageCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldShowThreadLoadingSkeleton({
        isLoading: true,
        messageCount: 3,
      }),
    ).toBe(false);

    expect(
      shouldShowThreadLoadingSkeleton({
        isLoading: false,
        messageCount: 0,
      }),
    ).toBe(false);
  });
});
