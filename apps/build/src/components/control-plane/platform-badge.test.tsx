import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
}));

import { PlatformBadge } from "./platform-badge";

function visit(search: string) {
  window.history.replaceState({}, "", `/projects${search}`);
}

afterEach(() => {
  window.localStorage.clear();
  visit("");
});

describe("PlatformBadge", () => {
  it("names the platform the current page rendered against", async () => {
    visit("?platform=somm.finance");
    render(<PlatformBadge />);

    expect(await screen.findByText("somm.finance")).toBeInTheDocument();
  });

  it("falls back to Community when nothing scopes the page", async () => {
    render(<PlatformBadge />);

    expect(await screen.findByText("community")).toBeInTheDocument();
  });

  it("leads to the platform selector", () => {
    render(<PlatformBadge />);

    expect(
      screen.getByRole("link", { name: /Change platform/ }),
    ).toHaveAttribute("href", "/settings/general");
  });
});
