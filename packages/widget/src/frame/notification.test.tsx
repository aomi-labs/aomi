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

vi.mock("@aomi-labs/react", () => ({
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

  it("dismisses notification state after the default six-second banner", () => {
    notificationState.notifications = [
      {
        id: "notice-1",
        type: "notice",
        title: "Backend connected",
        timestamp: Date.now(),
      },
    ];

    render(
      <WidgetScope>
        <NotificationToaster />
      </WidgetScope>,
    );

    act(() => vi.advanceTimersByTime(5999));
    expect(notificationState.dismissNotification).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(notificationState.dismissNotification).toHaveBeenCalledWith(
      "notice-1",
    );
  });

  it("preserves an explicit notification duration", () => {
    notificationState.notifications = [
      {
        id: "notice-2",
        type: "notice",
        title: "Longer notice",
        timestamp: Date.now(),
        duration: 9000,
      },
    ];

    render(
      <WidgetScope>
        <NotificationToaster />
      </WidgetScope>,
    );

    act(() => vi.advanceTimersByTime(6000));
    expect(notificationState.dismissNotification).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(3000));
    expect(notificationState.dismissNotification).toHaveBeenCalledWith(
      "notice-2",
    );
  });
});
