import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notificationState = vi.hoisted(() => ({
  notifications: [] as Array<{
    id: string;
    type: "notice";
    title: string;
    timestamp: number;
    duration?: number;
  }>,
  dismissNotification: vi.fn(),
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useNotification: () => notificationState,
}));

import { NotificationToaster } from "./notification";
import { WidgetScope } from "@/ui/widget-scope";

describe("NotificationToaster", () => {
  beforeEach(() => {
    notificationState.notifications = [];
    notificationState.dismissNotification.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([
    [undefined, 5999, 1],
    [9000, 6000, 3000],
  ])(
    "dismisses duration %s after %i + %i ms",
    (duration, quietMs, remainingMs) => {
      notificationState.notifications = [
        {
          id: "notice-1",
          type: "notice",
          title: "Backend connected",
          timestamp: Date.now(),
          duration,
        },
      ];

      render(
        <WidgetScope>
          <NotificationToaster />
        </WidgetScope>,
      );

      act(() => vi.advanceTimersByTime(quietMs));
      expect(notificationState.dismissNotification).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(remainingMs));
      expect(notificationState.dismissNotification).toHaveBeenCalledWith(
        "notice-1",
      );
    },
  );
});
