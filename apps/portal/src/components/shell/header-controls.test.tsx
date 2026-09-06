import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HeaderControls } from "./header-controls";

vi.mock("@aomi-labs/widget-lib", () => ({
  NetworkSelect: () => <button type="button">Network</button>,
}));

vi.mock("@portal/lib/use-settings", () => ({
  useSettings: () => ({
    settings: { colorMode: "dark" },
    updateSetting: vi.fn(),
  }),
}));

afterEach(cleanup);

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
      screen.getByRole("button", { name: "Browse packages" }),
    ).toBeInTheDocument();
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
});
