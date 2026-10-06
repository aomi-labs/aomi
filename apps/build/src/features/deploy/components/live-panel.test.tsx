import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LivePanel } from "./live-panel";

vi.mock("@aomi-labs/widget-lib", () => ({}));

const TEMPLATE_URL = "https://github.com/aomi-labs/playground-example";

describe("LivePanel", () => {
  it("renders success state with repo name", () => {
    render(<LivePanel repo="user/my-agent" />);
    const matches = screen.getAllByText(/user\/my-agent/);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(/is live/)).toBeInTheDocument();
  });

  it("renders success state without repo", () => {
    render(<LivePanel />);
    expect(screen.getByText(/Your agent is live/)).toBeInTheDocument();
  });

  it("renders clone instructions with repo", () => {
    render(<LivePanel repo="user/my-agent" />);
    expect(screen.getByText(/Clone, edit a tool/i)).toBeInTheDocument();
  });

  it("renders the correct clone command", () => {
    render(<LivePanel repo="user/my-agent" />);
    expect(screen.getByText(/git clone.*user\/my-agent/)).toBeInTheDocument();
  });

  it("renders open repo link", () => {
    render(<LivePanel repo="user/my-agent" />);
    const link = screen.getByText("Open repo");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "https://github.com/user/my-agent",
    );
  });

  it("does not show chat link when chatUrl is not provided", () => {
    render(<LivePanel repo="user/my-agent" />);
    expect(screen.queryByText("Open in chat")).not.toBeInTheDocument();
  });

  it("shows chat link when chatUrl is provided", () => {
    render(
      <LivePanel
        repo="user/my-agent"
        chatUrl="https://chat.aomi.dev?app=my-agent"
      />,
    );
    const link = screen.getByText("Open in chat");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "https://chat.aomi.dev?app=my-agent",
    );
  });

  it("renders the chat frame when chatUrl is provided", () => {
    render(
      <LivePanel
        repo="user/my-agent"
        chatUrl="https://chat.aomi.dev?app=my-agent&lock_app=1"
      />,
    );
    const frame = screen.getByTitle("Chat with user/my-agent");
    expect(frame).toHaveAttribute(
      "src",
      "https://chat.aomi.dev?app=my-agent&lock_app=1",
    );
  });

  it("uses template repo URL fallback for clone", () => {
    render(<LivePanel />);
    const link = screen.getByText("Open repo");
    expect(link.closest("a")).toHaveAttribute("href", TEMPLATE_URL);
  });

  it("renders the aomi-build command snippet", () => {
    render(<LivePanel repo="user/my-agent" />);
    expect(screen.getByText(/aomi-build deploy/)).toBeInTheDocument();
  });

  it("uses repo dir name from repo slug", () => {
    render(<LivePanel repo="user/my-agent" />);
    const code = screen.getByText(/cd my-agent/);
    expect(code).toBeInTheDocument();
  });

  it("falls back to playground-example dir when no repo", () => {
    render(<LivePanel />);
    const code = screen.getByText(/cd playground-example/);
    expect(code).toBeInTheDocument();
  });
});
