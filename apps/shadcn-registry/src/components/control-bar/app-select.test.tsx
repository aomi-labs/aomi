import { fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  state: {
    authorizedApps: ["default", "partner-agent"],
    appDescriptors: [
      { name: "default" },
      { name: "partner-agent", applicationId: 42 },
    ],
  },
  getAuthorizedApps: vi.fn(async () => ["default", "partner-agent"]),
  getCurrentThreadApp: vi.fn(() => "default"),
  getCurrentThreadApplicationId: vi.fn(() => null),
  onAppSelect: vi.fn(),
  isProcessing: false,
}));

vi.mock("@aomi-labs/react", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  useControl: () => control,
  useAomiRuntime: () => ({ isRunning: control.isProcessing }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandInput: () => null,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandSeparator: () => null,
  CommandItem: ({
    children,
    onSelect,
    value: _value,
    ...props
  }: HTMLAttributes<HTMLButtonElement> & {
    onSelect?: () => void;
    value?: string;
  }) => (
    <button {...props} onClick={onSelect}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/icons", () => ({
  AllAppsIcon: () => null,
  getAppIcon: () => null,
}));

import { AppSelect } from "./app-select";

describe("AppSelect", () => {
  const baseState = {
    authorizedApps: [...control.state.authorizedApps],
    appDescriptors: [...control.state.appDescriptors],
  };

  beforeEach(() => {
    control.getAuthorizedApps.mockClear();
    control.onAppSelect.mockClear();
    control.state.authorizedApps = [...baseState.authorizedApps];
    control.state.appDescriptors = [...baseState.appDescriptors];
  });

  it("passes a hosted app's application id to the controller", () => {
    render(<AppSelect />);

    fireEvent.click(screen.getByRole("button", { name: "P Partner Agent" }));

    expect(control.onAppSelect).toHaveBeenCalledWith("partner-agent", {
      applicationId: 42,
    });
  });

  it("omits the orchestrator row when it is not authorized", () => {
    render(<AppSelect />);

    expect(screen.queryByText("Orchestrator")).toBeNull();
  });

  it("describes the default as Basic", () => {
    render(<AppSelect />);

    expect(screen.getAllByText("Basic")).toHaveLength(2);
    expect(
      screen.getByText("Use Basic without selecting an app"),
    ).toBeInTheDocument();
  });

  it("pins the orchestrator under Basic and keeps it out of the groups", () => {
    control.state.authorizedApps = ["default", "orchestrator", "partner-agent"];
    control.state.appDescriptors = [
      { name: "default" },
      { name: "orchestrator" },
      { name: "partner-agent", applicationId: 42 },
    ];

    render(<AppSelect />);

    expect(
      screen.getByText("Coordinate work across any number of apps"),
    ).toBeInTheDocument();
    // Pinned directly under the Basic row…
    const rows = screen.getAllByRole("button");
    const basicIndex = rows.findIndex((row) =>
      row.textContent?.includes("Use Basic without selecting an app"),
    );
    const orchestratorIndex = rows.findIndex((row) =>
      row.textContent?.includes("Orchestrator"),
    );
    expect(orchestratorIndex).toBe(basicIndex + 1);
    // …and listed exactly once (never again in a category group).
    expect(screen.getAllByText("Orchestrator")).toHaveLength(1);

    fireEvent.click(rows[orchestratorIndex]!);
    expect(control.onAppSelect).toHaveBeenCalledWith("orchestrator", {
      applicationId: undefined,
    });
  });

  it("shows the orchestrator icon in the selected trigger", () => {
    control.state.authorizedApps = ["default", "orchestrator"];
    control.state.appDescriptors = [
      { name: "default" },
      { name: "orchestrator" },
    ];
    control.getCurrentThreadApp.mockReturnValueOnce("orchestrator");

    render(<AppSelect />);

    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Orchestrator");
    expect(trigger.querySelector("svg.lucide-bot")).not.toBeNull();
  });
});
