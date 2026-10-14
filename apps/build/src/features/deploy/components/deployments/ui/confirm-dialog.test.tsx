import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("fires onConfirm when confirmed", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Roll back?"
        body="Sure?"
        confirmLabel="Roll back"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="x"
        body="y"
        confirmLabel="z"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
