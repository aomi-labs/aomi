import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HeaderControls } from "./header-controls";

const setActivityOpen = vi.fn();
let activityAvailable = false;
let activityOpen = false;

vi.mock("@aomi-labs/widget-lib", () => ({
  NetworkSelect: () => <button type="button">Network</button>,
  useActivityPanel: () => ({
    worthShowing: activityAvailable,
    reviewing: false,
    open: activityOpen,
    setOpen: setActivityOpen,
  }),
}));

vi.mock("@portal/lib/use-settings", () => ({
  useSettings: () => ({
    settings: { colorMode: "dark" },
    updateSetting: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  activityAvailable = false;
  activityOpen = false;
  setActivityOpen.mockReset();
});

describe("HeaderControls", () => {
  it("hides account settings while the Portal session is anonymous", () => {
    render(
      <HeaderControls
        showSettings={false}
        onOpenSettings={vi.fn()}
        onOpenPackages={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Open settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open capability library" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Chat activity unavailable" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Chat activity unavailable" }),
    );
    expect(setActivityOpen).not.toHaveBeenCalled();
  });

  it("shows account settings for an authenticated account", () => {
    render(
      <HeaderControls
        showSettings
        onOpenSettings={vi.fn()}
        onOpenPackages={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Open settings" }),
    ).toBeInTheDocument();
  });

  it("toggles available chat activity from the header", () => {
    activityAvailable = true;
    render(
      <HeaderControls
        showSettings
        onOpenSettings={vi.fn()}
        onOpenPackages={vi.fn()}
      />,
    );

    const theme = screen.getByRole("switch", { name: "Dark mode" });
    const activity = screen.getByRole("button", {
      name: "Show chat activity",
    });
    expect(theme.compareDocumentPosition(activity)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    fireEvent.click(activity);
    expect(setActivityOpen).toHaveBeenCalledWith(true);
  });
});
