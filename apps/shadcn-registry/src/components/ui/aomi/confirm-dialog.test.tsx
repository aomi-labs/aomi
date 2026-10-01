import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("confirms, then closes", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        title="Unlink wallet?"
        description="You can link it again later."
        confirmLabel="Unlink"
        tone="danger"
      />,
    );

    const dialog = screen.getByRole("alertdialog", { name: "Unlink wallet?" });
    expect(dialog).toHaveTextContent("You can link it again later.");
    // Cancel holds initial focus so Enter never commits by accident.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cancels without confirming", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        title="Delete account?"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("locks both actions and dismissal while busy", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        busyLabel="Deleting…"
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
        title="Delete account?"
      />,
    );

    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("useConfirmDialog", () => {
  function Harness({ onResult }: { onResult: (value: boolean) => void }) {
    const { confirm, dialog } = useConfirmDialog();
    return (
      <>
        <button
          type="button"
          onClick={async () =>
            onResult(await confirm({ title: "Sign out?", confirmLabel: "OK" }))
          }
        >
          Ask
        </button>
        {dialog}
      </>
    );
  }

  it("resolves true on confirm and false on cancel", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    expect(onResult).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(onResult).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
