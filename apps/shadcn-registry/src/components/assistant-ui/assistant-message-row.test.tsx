import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantMessageRow } from "./assistant-message-row";

afterEach(cleanup);
function setup(desktop = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop })),
  );
  render(
    <AssistantMessageRow showMark>
      <p>Working</p>
    </AssistantMessageRow>,
  );
  const content = screen.getByText("Working").parentElement!;
  return { content, row: content.parentElement! };
}
it("reveals the mark on a right swipe and resets on release or cancellation", () => {
  const { row, content } = setup();
  for (const end of ["touchEnd", "touchCancel"] as const) {
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 170, clientY: 102 }] });
    expect(content.style.transform).toContain("translateX");
    fireEvent[end](row);
    expect(content.style.transform).toBe("");
  }
});
it("leaves vertical scrolling and desktop gestures alone", () => {
  const { row, content } = setup();
  fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 104, clientY: 150 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 180, clientY: 150 }] });
  expect(content.style.transform).toBe("");
  cleanup();
  const desktop = setup(true);
  fireEvent.touchStart(desktop.row, {
    touches: [{ clientX: 100, clientY: 100 }],
  });
  fireEvent.touchMove(desktop.row, {
    touches: [{ clientX: 180, clientY: 100 }],
  });
  expect(desktop.content.style.transform).toBe("");
});
