import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AomiAppDescriptor } from "@aomi-labs/client";
import {
  appSelectionUrl,
  PortalAppSelector,
  PortalHeaderAppSelector,
} from "./portal-app-selector";

const fixture = vi.hoisted(() => ({
  apps: [] as AomiAppDescriptor[],
  sidebar: { isMobile: false, open: true },
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useAuthEndpoints: () => ({ state: { appDescriptors: fixture.apps } }),
}));
vi.mock("@aomi-labs/widget-lib/host-composition", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@aomi-labs/widget-lib/host-composition")
    >();
  return {
    getAppIcon: original.getAppIcon,
    resolveAppIdentity: original.resolveAppIdentity,
    Popover: original.Popover,
    PopoverContent: original.PopoverContent,
    PopoverTrigger: original.PopoverTrigger,
    useSidebar: () => fixture.sidebar,
  };
});

const requestedApp = {
  app: "hoodit",
  applicationId: "2937810",
  locked: true,
  inferenceFunding: undefined,
};

afterEach(() => {
  fixture.apps = [];
  fixture.sidebar = { isMobile: false, open: true };
});

describe("Portal app context", () => {
  it("leaves ordinary Auto chats without a selected-app indicator", () => {
    render(
      <PortalAppSelector
        requestedApp={{
          ...requestedApp,
          app: null,
          applicationId: null,
          locked: false,
        }}
        enabledApps={["default"]}
      />,
    );
    expect(screen.queryByTestId("portal-selected-app")).toBeNull();
  });
  it("shows the URL app with its logo before the catalog loads, without a locked dropdown", () => {
    render(<PortalAppSelector requestedApp={requestedApp} enabledApps={[]} />);
    const indicator = screen.getByLabelText("Selected app: Hoodit (locked)");
    expect(indicator).toHaveTextContent("HooditLocked");
    expect(indicator.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(indicator.querySelector(".lucide-app-window")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a generic icon for an app with no reviewed logo", () => {
    render(
      <PortalAppSelector
        requestedApp={{ ...requestedApp, app: "my-private-agent" }}
        enabledApps={[]}
      />,
    );
    const indicator = screen.getByLabelText(
      "Selected app: My Private Agent (locked)",
    );
    expect(indicator.firstElementChild).toHaveClass("lucide-app-window");
  });

  it("resolves same-name apps by application id and keeps community branding distinct", () => {
    fixture.apps = [
      { name: "hoodit", applicationId: 11, metadata: { source: "official" } },
      {
        name: "hoodit",
        applicationId: 2937810,
        label: "My Research App",
        isPublic: false,
      },
    ];
    render(<PortalAppSelector requestedApp={requestedApp} enabledApps={[]} />);
    const indicator = screen.getByLabelText(
      "Selected app: My Research App (locked)",
    );
    expect(indicator.firstElementChild).toHaveClass("lucide-app-window");
  });

  it("offers enabled apps and Auto only when the context is unlocked", () => {
    fixture.apps = [
      { name: "hoodit" },
      { name: "custom-agent", label: "Custom Agent" },
      { name: "disabled-agent" },
      {
        name: "hoodit",
        applicationId: 44,
        label: "Uninstalled duplicate",
        isInstalled: false,
        isPublic: false,
      },
    ];
    render(
      <PortalAppSelector
        requestedApp={{ ...requestedApp, locked: false, applicationId: null }}
        enabledApps={["hoodit", "custom-agent"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select app: Hoodit" }));
    expect(screen.getByRole("button", { name: "Auto" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hoodit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Custom Agent" })).toBeVisible();
    expect(screen.queryByText("Disabled Agent")).toBeNull();
    expect(screen.queryByText("Uninstalled duplicate")).toBeNull();
  });

  it("keeps app context in the header on mobile and with a collapsed sidebar", () => {
    const view = render(
      <PortalHeaderAppSelector requestedApp={requestedApp} enabledApps={[]} />,
    );
    expect(screen.queryByText("Hoodit")).toBeNull();
    fixture.sidebar.open = false;
    view.rerender(
      <PortalHeaderAppSelector requestedApp={requestedApp} enabledApps={[]} />,
    );
    expect(screen.getByText("Hoodit")).toBeVisible();
    fixture.sidebar = { isMobile: true, open: true };
    view.rerender(
      <PortalHeaderAppSelector requestedApp={requestedApp} enabledApps={[]} />,
    );
    expect(screen.getByText("Hoodit")).toBeVisible();
  });

  it("changes only app/thread URL context and retains funding and unrelated parameters", () => {
    const current =
      "https://chat.aomi.dev/?aomi_app=old&applicationId=1&thread=old&funding=user_byok&utm_source=test#chat";
    const selected = new URL(
      appSelectionUrl(current, { name: "new-app", applicationId: 42 }),
      current,
    );
    expect(Object.fromEntries(selected.searchParams)).toEqual({
      funding: "user_byok",
      utm_source: "test",
      app: "new-app",
      application_id: "42",
    });
    expect(selected.hash).toBe("#chat");
    const auto = new URL(appSelectionUrl(selected.href, null), current);
    expect(auto.searchParams.has("app")).toBe(false);
    expect(auto.searchParams.has("application_id")).toBe(false);
  });
});
