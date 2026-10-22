import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

import { SettingsNav } from "./settings-nav";
import { settingsSections } from "./settings-data";

describe("SettingsNav", () => {
  beforeEach(() => {
    usePathname.mockReset();
  });

  it("highlights Overview on /settings", () => {
    usePathname.mockReturnValue("/settings");

    render(<SettingsNav />);

    const overview = screen.getByRole("link", { name: /^overview$/i });
    expect(overview).toHaveAttribute("data-active", "true");
    expect(overview).toHaveAttribute("href", "/settings");

    const billing = screen.getByRole("link", { name: /billing/i });
    expect(billing).not.toHaveAttribute("data-active", "true");
  });

  it("highlights the active section and lists all sections", () => {
    usePathname.mockReturnValue("/settings/billing");

    render(<SettingsNav />);

    const overview = screen.getByRole("link", { name: /^overview$/i });
    expect(overview).not.toHaveAttribute("data-active", "true");

    const billing = screen.getByRole("link", { name: /billing/i });
    expect(billing).toHaveAttribute("data-active", "true");
    expect(billing).toHaveAttribute("href", "/settings/billing");

    for (const section of settingsSections) {
      expect(
        screen.getByRole("link", { name: new RegExp(section.title, "i") }),
      ).toHaveAttribute("href", `/settings/${section.slug}`);
    }
  });

  it("shows status badges for soon and project-scoped sections", () => {
    usePathname.mockReturnValue("/settings");

    render(<SettingsNav />);

    expect(screen.getAllByText("Soon").length).toBeGreaterThan(0);
    expect(screen.getByText("Project-scoped")).toBeInTheDocument();
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
  });
});
