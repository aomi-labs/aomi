import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsePending } from "./response-pending";

afterEach(() => vi.useRealTimers());

describe("response start feedback", () => {
  it("keeps the slow timer across creation and response admission", () => {
    vi.useFakeTimers();
    const view = render(<ResponsePending creating stopping={false} />);
    act(() => vi.advanceTimersByTime(4000));
    view.rerender(<ResponsePending creating={false} stopping={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Starting response");
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "taking a little longer",
    );
  });

  it("waits for Stop confirmation and resets the timer for a new response", () => {
    vi.useFakeTimers();
    const view = render(<ResponsePending creating={false} stopping />);
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "server to confirm Stop",
    );
    view.unmount();
    render(<ResponsePending creating={false} stopping={false} />);
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "taking a little longer",
    );
  });
});
