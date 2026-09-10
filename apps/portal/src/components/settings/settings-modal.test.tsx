import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsModal } from "./settings-modal";

const session = vi.hoisted(() => ({
  status: "ready" as "ready" | "anonymous" | "establishing" | "error",
  retry: vi.fn(),
}));

vi.mock("@portal/components/providers/aomi-session-bridge", () => ({
  useAomiSession: () => session,
}));

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => ({
    identity: { isConnected: true },
    connect: vi.fn(),
  }),
}));

vi.mock("@portal/features/general", () => ({
  GeneralSettings: ({
    onManageAccount,
    onViewUsage,
  }: {
    onManageAccount: () => void;
    onViewUsage: () => void;
  }) => (
    <div>
      General content
      <button type="button" onClick={onManageAccount}>
        Manage account
      </button>
      <button type="button" onClick={onViewUsage}>
        View usage
      </button>
    </div>
  ),
}));

vi.mock("@portal/features/account", () => ({
  AccountSettings: () => <div>Account content</div>,
}));

vi.mock("@portal/features/usage", () => ({
  UsageSettings: () => <div>Usage content</div>,
}));

describe("SettingsModal directory shell", () => {
  it("matches the Library frame and keeps navigation in the sidebar", () => {
    render(<SettingsModal onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.style.width).toBe("1080px");
    expect(dialog.style.height).toBe("620px");
    expect(dialog.style.maxWidth).toBe("96%");
    expect(
      screen.getByRole("navigation", { name: "Settings sections" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toHaveClass(
      "text-[15px]",
    );
    expect(screen.getByRole("button", { name: "General" })).toHaveClass(
      "text-[13px]",
    );
    expect(screen.getByRole("heading", { name: "General" })).toHaveClass(
      "text-[15px]",
    );
    expect(
      screen.getByText("Appearance, defaults, and account overview"),
    ).toBeTruthy();
  });

  it("switches sections from both the sidebar and in-content actions", () => {
    render(<SettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("Account content")).toBeTruthy();
    expect(
      screen.getByText("Wallets, sign-in methods, and signing"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "View usage" }));
    expect(screen.getByText("Usage content")).toBeTruthy();
    expect(screen.getByText("Spend, allowance, and statements")).toBeTruthy();
  });

  it("closes from the sidebar control", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
