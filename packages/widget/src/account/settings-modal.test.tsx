import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsModal } from "../../../../shadcn-registry/src/components/account-shell/components/settings/settings-modal";

const session = vi.hoisted(() => ({
  status: "ready" as "ready" | "anonymous" | "establishing" | "error",
  retry: vi.fn(),
}));

vi.mock(
  "../../../../shadcn-registry/src/components/account-shell/components/providers/aomi-session-bridge",
  () => ({
    useAomiSession: () => session,
  }),
);

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => ({
    identity: { isConnected: true },
    connect: vi.fn(),
  }),
}));

vi.mock("../../../../shadcn-registry/src/lib/wallet-kit/context", () => ({
  useAomiWalletKit: () => ({
    identity: { isConnected: true },
    connect: vi.fn(),
  }),
}));

vi.mock(
  "../../../../shadcn-registry/src/components/account-shell/features/general",
  () => ({
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
  }),
);

vi.mock(
  "../../../../shadcn-registry/src/components/account-shell/features/account",
  () => ({
    AccountSettings: () => <div>Account content</div>,
  }),
);

vi.mock(
  "../../../../shadcn-registry/src/components/account-shell/features/usage",
  () => ({
    UsageSettings: () => <div>Usage content</div>,
  }),
);

vi.mock(
  "../../../../shadcn-registry/src/components/account-shell/features/policy",
  () => ({
    PolicyPage: () => <div>Policy content</div>,
  }),
);

describe("SettingsModal directory shell", () => {
  afterEach(() => {
    session.status = "ready";
  });

  it("matches the Library frame and keeps navigation in the sidebar", () => {
    render(<SettingsModal onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.style.width).toBe("1000px");
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
      "type-title",
    );
    expect(screen.getByRole("button", { name: "General" })).toHaveClass(
      "type-control",
    );
    expect(screen.getByRole("heading", { name: "General" })).toHaveClass(
      "type-title",
    );
    expect(dialog).toHaveClass("rounded-shell", "shadow-modal");
    expect(
      screen.getByText("Appearance, defaults, and account overview"),
    ).toBeTruthy();
  });

  it("switches sections from both the sidebar and in-content actions", () => {
    render(<SettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("Account content")).toBeTruthy();
    expect(screen.getByText("Wallets and sign-in methods")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Safety" }));
    expect(screen.getByText("Policy content")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Safety" })).toBeTruthy();
    expect(
      screen.getByText("Guard policy and signing permissions"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "View usage" }));
    expect(screen.getByText("Usage content")).toBeTruthy();
    expect(screen.getByText("Spend, allowance, and statements")).toBeTruthy();
  });

  it("gives every tab the same reading column", () => {
    render(<SettingsModal onClose={vi.fn()} />);

    for (const [tab, content] of [
      ["General", "General content"],
      ["Account", "Account content"],
      ["Safety", "Policy content"],
      ["Usage", "Usage content"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      const column = screen
        .getByText(content)
        .closest("[data-settings-column]");
      expect(column).toHaveClass("w-full", "px-6");
      expect(column).not.toHaveClass("mx-auto");
    }
  });

  it("closes from the sidebar control", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when an account session ends while settings is open", () => {
    const onClose = vi.fn();
    const view = render(
      <SettingsModal onClose={onClose} initialTab="account" />,
    );

    session.status = "establishing";
    view.rerender(<SettingsModal onClose={onClose} initialTab="account" />);
    expect(onClose).not.toHaveBeenCalled();

    session.status = "anonymous";
    view.rerender(<SettingsModal onClose={onClose} initialTab="account" />);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("keeps visited account content mounted during a refresh", () => {
    const view = render(
      <SettingsModal onClose={vi.fn()} initialTab="account" />,
    );
    const content = screen.getByText("Account content");
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(content).toBeInTheDocument();
    expect(content).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    session.status = "establishing";
    view.rerender(<SettingsModal onClose={vi.fn()} initialTab="account" />);
    expect(screen.getByText("Account content")).toBe(content);
    expect(content).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a centered spinner while the first session is restoring", () => {
    session.status = "establishing";
    render(<SettingsModal onClose={vi.fn()} />);
    expect(
      screen.getByRole("status", { name: "Connecting your account" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("General content")).toBeNull();
  });
});
