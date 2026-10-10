import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { setLastProjectId } from "@/lib/last-project";

const push = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test-navigation-link")).TestNavigationLink,
  useRouter: () => ({ navigate: ({ href }: { href: string }) => push(href) }),
  useLocation: (options: {
    select: (location: { pathname: string; searchStr: string }) => unknown;
  }) =>
    options.select({
      pathname: "/projects",
      searchStr: new URLSearchParams().toString(),
    }),
}));

import { CommandPalette, openCommandPalette } from "./command-palette";

describe("CommandPalette", () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("opens from the header Search event", async () => {
    render(<CommandPalette />);
    expect(
      screen.queryByRole("dialog", { name: /command palette/i }),
    ).toBeNull();

    openCommandPalette();

    expect(
      await screen.findByRole("dialog", { name: /command palette/i }),
    ).toBeInTheDocument();
  });

  it("toggles open on ⌘K / Ctrl+K", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, {
      key: "k",
      code: "KeyK",
      metaKey: true,
    });

    expect(
      await screen.findByRole("dialog", { name: /command palette/i }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, {
      key: "k",
      code: "KeyK",
      metaKey: true,
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /command palette/i }),
      ).toBeNull();
    });
  });

  it("deep-links last project Home, Environment, and Usage", async () => {
    setLastProjectId(42);
    render(<CommandPalette />);
    openCommandPalette();

    await screen.findByRole("dialog", { name: /command palette/i });

    fireEvent.click(screen.getByRole("button", { name: /^last project\b/i }));
    expect(push).toHaveBeenCalledWith("/projects/42?platform=community");

    push.mockClear();
    openCommandPalette();
    await screen.findByRole("dialog", { name: /command palette/i });
    fireEvent.click(
      screen.getByRole("button", { name: /^environment \/ secrets\b/i }),
    );
    expect(push).toHaveBeenCalledWith(
      "/projects/42?tab=environment&platform=community",
    );

    push.mockClear();
    openCommandPalette();
    await screen.findByRole("dialog", { name: /command palette/i });
    fireEvent.click(screen.getByRole("button", { name: /^usage\b/i }));
    expect(push).toHaveBeenCalledWith("/operate/usage?project=42");
  });
});
