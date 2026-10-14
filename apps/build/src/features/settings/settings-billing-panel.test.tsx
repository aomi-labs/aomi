import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { setLastProjectId } from "@/lib/last-project";

vi.mock("@/lib/chat-url", () => ({
  resolveChatUrl: () => "https://chat.aomi.dev",
}));

import { SettingsBillingPanel } from "./settings-billing-panel";

describe("SettingsBillingPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("keeps short product copy without rail jargon or fake invoices", () => {
    render(<SettingsBillingPanel />);

    expect(screen.getByText(/^payment setup$/i)).toBeInTheDocument();
    expect(screen.getByText(/managed in/i)).toBeInTheDocument();
    expect(screen.getByText(/^coming later$/i)).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /operate → usage/i }),
    ).toHaveAttribute("href", "/operate/usage");
    expect(
      screen.getByRole("link", { name: /secrets → environment/i }),
    ).toHaveAttribute("href", "/settings/secrets");
    expect(screen.getByRole("link", { name: /open chat/i })).toHaveAttribute(
      "href",
      "https://chat.aomi.dev",
    );

    expect(screen.queryByText(/tempo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/byok/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/x402/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invoice #/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("deep-links Usage and Environment to the last project when set", () => {
    setLastProjectId(9);
    render(<SettingsBillingPanel />);
    expect(
      screen.getByRole("link", { name: /operate → usage/i }),
    ).toHaveAttribute("href", "/operate/usage?project=9");
    expect(
      screen.getByRole("link", { name: /secrets → environment/i }),
    ).toHaveAttribute("href", "/projects/9?tab=environment");
  });
});
