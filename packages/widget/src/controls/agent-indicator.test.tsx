import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testIds } from "@/test-ids";
import type { AgentCard } from "@aomi-labs/client";
import { AgentIndicator } from "./agent-indicator";

const fixture = vi.hoisted(() => ({ agents: [] as AgentCard[] }));
vi.mock("@aomi-labs/react", () => ({
  useAuthEndpoints: () => ({ state: { agentCards: fixture.agents } }),
}));
afterEach(() => {
  fixture.agents = [];
});

describe("composer agent indicator", () => {
  it("leaves Auto without agent context unchanged", () => {
    render(<AgentIndicator />);
    expect(screen.queryByTestId(testIds.composerSelectedAgent)).toBeNull();
  });
  it("shows only an icon and name before the catalog loads", () => {
    render(<AgentIndicator agent={{ agent: "aomi/hoodit" }} />);
    const indicator = screen.getByLabelText("Selected agent: Hoodit");
    expect(indicator).toHaveTextContent(/^Hoodit$/);
    // A package-backed agent has no logo in TS.
    expect(indicator.querySelector("svg")).toHaveClass("lucide-app-window");
    expect(screen.queryByRole("button")).toBeNull();
    expect(indicator).not.toHaveAttribute("tabindex");
  });
  it("uses a generic icon for agents without a reviewed logo", () => {
    render(<AgentIndicator agent={{ agent: "aomi/my-private-agent" }} />);
    const indicator = screen.getByLabelText("Selected agent: My Private Agent");
    expect(indicator.querySelector("svg")).toHaveClass("lucide-app-window");
    expect(indicator).toHaveAttribute("title", "My Private Agent");
  });
  it("selects the exact publisher slug and preserves its own branding", () => {
    fixture.agents = [
      {
        agent_id: 11,
        agent: "aomi/hoodit",
        display_name: "Hoodit",
        metadata: {},
      },
      {
        agent_id: 12,
        agent: "publisher/hoodit",
        display_name: "My Research Agent",
        metadata: {},
      },
    ];
    render(<AgentIndicator agent={{ agent: "publisher/hoodit" }} />);
    const indicator = screen.getByLabelText(
      "Selected agent: My Research Agent",
    );
    expect(indicator.querySelector("svg")).toHaveClass("lucide-app-window");
  });
  it("refreshes the display name for the same canonical slug", () => {
    const view = render(
      <AgentIndicator agent={{ agent: "publisher/research" }} />,
    );
    expect(screen.getByLabelText("Selected agent: Research")).toBeVisible();
    fixture.agents = [
      {
        agent_id: 42,
        agent: "publisher/research",
        display_name: "Research Agent",
        metadata: {},
      },
    ];
    view.rerender(<AgentIndicator agent={{ agent: "publisher/research" }} />);
    expect(
      screen.getByLabelText("Selected agent: Research Agent"),
    ).toBeVisible();
  });
});
