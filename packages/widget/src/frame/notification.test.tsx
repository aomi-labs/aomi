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

vi.mock("sonner", () => ({
  toast: {
    custom: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("./sonner", () => ({
  Toaster: () => null,
}));

import { toast } from "sonner";

import { NotificationToaster } from "./notification";

describe("NotificationToaster", () => {
  beforeEach(() => {
    notificationState.notifications = [];
    notificationState.dismissNotification.mockReset();
    vi.mocked(toast.custom).mockReset();
  });

  afterEach(cleanup);

  it("dismisses notification state after the default six-second banner", () => {
    notificationState.notifications = [
      {
        id: "notice-1",
        type: "notice",
        title: "Backend connected",
        timestamp: Date.now(),
      },
    ];

    render(<NotificationToaster />);

    const options = vi.mocked(toast.custom).mock.calls[0]?.[1];
    expect(options).toMatchObject({ id: "notice-1", duration: 6000 });

    act(() => options?.onAutoClose?.({} as never));

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

    render(<NotificationToaster />);

    expect(vi.mocked(toast.custom).mock.calls[0]?.[1]).toMatchObject({
      id: "notice-2",
      duration: 9000,
    });
  });
});
