import { render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { WidgetScope, useWidgetOverlay } from "./widget-scope";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
it("portals each instance's dialogs into its own scoped overlay container", async () => {
  const view = render(
    <>
      <WidgetScope className="light">
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Light dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </WidgetScope>
      <WidgetScope className="dark">
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Dark dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </WidgetScope>
    </>,
  );
  await waitFor(() => {
    const dialogs = view.container.querySelectorAll(
      '[data-aomi-overlays] [role="dialog"]',
    );
    expect(dialogs).toHaveLength(2);
    expect(
      dialogs[0].closest(".aomi-widget")?.classList.contains("light"),
    ).toBe(true);
    expect(dialogs[1].closest(".aomi-widget")?.classList.contains("dark")).toBe(
      true,
    );
  });
});

it("gives overlays their container on the first render, never document.body", () => {
  const seen: (HTMLElement | null)[] = [];
  function Probe() {
    seen.push(useWidgetOverlay());
    return null;
  }
  render(
    <WidgetScope>
      <Probe />
    </WidgetScope>,
  );
  expect(seen[0]).toBeInstanceOf(HTMLElement);
  expect(seen[0]?.isConnected).toBe(true);
  expect(seen[0]?.closest(".aomi-widget")).not.toBeNull();
});
