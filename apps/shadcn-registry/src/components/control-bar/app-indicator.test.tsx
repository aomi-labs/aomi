import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AomiAppDescriptor } from "@aomi-labs/client";
import { AppIndicator } from "./app-indicator";

const fixture = vi.hoisted(() => ({ apps: [] as AomiAppDescriptor[] }));
vi.mock("@aomi-labs/react", () => ({
  useAuthEndpoints: () => ({ state: { appDescriptors: fixture.apps } }),
}));
afterEach(() => {
  fixture.apps = [];
});

describe("composer app indicator", () => {
  it("leaves Auto without app context unchanged", () => {
    render(<AppIndicator />);
    expect(screen.queryByTestId("composer-selected-app")).toBeNull();
  });
  it("shows only a known logo and name before the catalog loads", () => {
    render(<AppIndicator app={{ app: "hoodit", applicationId: 2937810 }} />);
    const indicator = screen.getByLabelText("Selected app: Hoodit");
    expect(indicator).toHaveTextContent(/^Hoodit$/);
    expect(indicator.querySelector("svg")).not.toHaveClass("lucide-app-window");
    expect(screen.queryByRole("button")).toBeNull();
    expect(indicator).not.toHaveAttribute("tabindex");
  });
  it("uses a generic icon for apps without a reviewed logo", () => {
    render(<AppIndicator app={{ app: "my-private-agent" }} />);
    const indicator = screen.getByLabelText("Selected app: My Private Agent");
    expect(indicator.querySelector("svg")).toHaveClass("lucide-app-window");
    expect(indicator).toHaveAttribute("title", "My Private Agent");
  });
  it("resolves duplicate names by hosted id and respects publisher branding", () => {
    fixture.apps = [
      { name: "hoodit", applicationId: 11, metadata: { source: "official" } },
      {
        name: "hoodit",
        applicationId: 2937810,
        label: "My Research App",
        isPublic: false,
      },
    ];
    render(<AppIndicator app={{ app: "hoodit", applicationId: 2937810 }} />);
    const indicator = screen.getByLabelText("Selected app: My Research App");
    expect(indicator.querySelector("svg")).toHaveClass("lucide-app-window");
  });
  it("resolves a Direct app identified only by application id", () => {
    fixture.apps = [
      { name: "private-agent", applicationId: 42, label: "Private Agent" },
    ];
    render(<AppIndicator app={{ applicationId: 42 }} />);
    expect(
      screen.getByLabelText("Selected app: Private Agent"),
    ).toHaveTextContent("Private Agent");
  });
});
