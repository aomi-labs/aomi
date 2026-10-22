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
    {
      name: "after the default six-second banner",
      duration: undefined,
      quietMs: 5999,
      remainingMs: 1,
    },
    {
      name: "after an explicit notification duration",
      duration: 9000,
      quietMs: 6000,
      remainingMs: 3000,
    },
  ])("dismisses notification state $name", ({ duration, quietMs, remainingMs }) => {
    notificationState.notifications = [
      {
        id: "notice-1",
        type: "notice",
        title: "Backend connected",
        timestamp: Date.now(),
        ...(duration === undefined ? {} : { duration }),
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
  });
});
