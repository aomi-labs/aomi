import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { push, deploymentProjects } = vi.hoisted(() => ({
  push: vi.fn(),
  deploymentProjects: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test-navigation-link")).TestNavigationLink,
  useRouter: () => ({ navigate: ({ href }: { href: string }) => push(href) }),
  useLocation: (options: {
    select: (location: { pathname: string; searchStr: string }) => unknown;
  }) =>
    options.select({
      pathname: "/settings/general",
      searchStr: new URLSearchParams().toString(),
    }),
}));
vi.mock("@/features/deploy/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/deploy/client")>();
  return { ...original, deploymentProjects };
});
vi.mock("@/components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({
    account: {
      loading: false,
      signedIn: true,
      githubLogin: "alice",
      githubAvatarUrl: null,
      installationId: null,
    },
  }),
}));

import { LaunchRequestError } from "@/features/deploy/client";
import { buildQueryKeys } from "@/features/deploy/query-keys";
import { PlatformSwitcher } from "./platform-switcher";

function renderSwitcher(currentPlatform: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PlatformSwitcher currentPlatform={currentPlatform} />
    </QueryClientProvider>,
  );
  return client;
}

describe("PlatformSwitcher", () => {
  beforeEach(() => {
    push.mockReset();
    deploymentProjects.mockReset();
  });

  it("switches only after an exact platform source lookup succeeds", async () => {
    const result = { projects: [] };
    deploymentProjects.mockResolvedValue(result);
    const client = renderSwitcher();
    const input = screen.getByRole("textbox", { name: "Platform name" });

    fireEvent.change(input, { target: { value: "  somm.finance  " } });
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/projects?platform=somm.finance"),
    );
    expect(deploymentProjects).toHaveBeenCalledWith("somm.finance");
    expect(
      client.getQueryData(buildQueryKeys.projects("alice", "somm.finance")),
    ).toEqual(result);
  });

  it("keeps the current platform when the exact name is not found", async () => {
    deploymentProjects.mockRejectedValue(
      new LaunchRequestError("deployment projects failed", 404, {}),
    );
    renderSwitcher("community");
    const input = screen.getByRole("textbox", { name: "Platform name" });

    fireEvent.change(input, { target: { value: "missing.partner" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Platform not found. Nothing changed",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("returns to explicitly scoped Community projects without a lookup", () => {
    renderSwitcher("somm.finance");

    expect(
      screen.getByRole("button", { name: "What is Community?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Aomi's default platform",
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Community" }));

    expect(push).toHaveBeenCalledWith("/projects?platform=community");
    expect(deploymentProjects).not.toHaveBeenCalled();
  });

  it("disables Switch until a platform name is entered", () => {
    renderSwitcher();

    expect(screen.getByRole("button", { name: "Switch" })).toBeDisabled();
  });
});
