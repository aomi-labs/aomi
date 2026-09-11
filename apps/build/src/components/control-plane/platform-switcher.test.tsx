import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { push, deploymentProjects } = vi.hoisted(() => ({
  push: vi.fn(),
  deploymentProjects: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/general",
}));
vi.mock("@build/features/launch/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@build/features/launch/client")>();
  return { ...original, deploymentProjects };
});
vi.mock("@build/components/control-plane/github-session-context", () => ({
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

import { LaunchRequestError } from "@build/features/launch/client";
import { buildQueryKeys } from "@build/features/launch/query-keys";
import { PlatformSwitcher } from "./platform-switcher";

/** The account-wide read the platform list is derived from. */
function projectsOn(...platformNames: string[]) {
  return {
    projects: platformNames.map((platformName, index) => ({
      id: index + 1,
      platformName,
    })),
  };
}

/** `deploymentProjects()` answers the list read; `deploymentProjects(name)` is
 *  the exact-name verification. Route them separately so a test can fail one
 *  without disturbing the other. */
function respond({
  list,
  scoped,
}: {
  list?: unknown;
  scoped?: (platform: string) => unknown;
} = {}) {
  deploymentProjects.mockImplementation((platform?: string) => {
    if (platform === undefined) {
      return list === undefined
        ? Promise.reject(new Error("list unavailable"))
        : Promise.resolve(list);
    }
    return scoped
      ? Promise.resolve(scoped(platform))
      : Promise.reject(new Error("no scoped response configured"));
  });
}

/** Calls that verify one platform by name — the list read is not one. */
function scopedCalls() {
  return deploymentProjects.mock.calls.filter((call) => call[0] !== undefined)
    .length;
}

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

  describe("the platforms you can reach", () => {
    it("lists each distinct platform your projects are on, once", async () => {
      respond({ list: projectsOn("somm.finance", "somm.finance", "byreal") });
      renderSwitcher("community");

      const list = await screen.findByRole("list", { name: "Your platforms" });
      const rows = within(list).getAllByRole("listitem");
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("community"),
        expect.stringContaining("byreal"),
        expect.stringContaining("somm.finance"),
      ]);
      expect(within(list).getByText("2 projects")).toBeInTheDocument();
    });

    it("always offers Community, and marks the platform you are on", async () => {
      respond({ list: projectsOn("somm.finance") });
      renderSwitcher("somm.finance");

      const list = await screen.findByRole("list", { name: "Your platforms" });
      expect(within(list).getByText("community")).toBeInTheDocument();
      expect(within(list).getByText("No projects yet")).toBeInTheDocument();
      expect(within(list).getByText("Current")).toBeInTheDocument();
      expect(
        within(list).getByRole("button", { current: true }),
      ).toHaveTextContent("somm.finance");
    });

    it("shows the platform you are on even before it owns a project", async () => {
      respond({ list: projectsOn() });
      renderSwitcher("new.partner");

      const list = await screen.findByRole("list", { name: "Your platforms" });
      expect(within(list).getByText("new.partner")).toBeInTheDocument();
    });

    it("switches on click without re-verifying a name it just read", async () => {
      respond({ list: projectsOn("somm.finance") });
      renderSwitcher("community");

      const list = await screen.findByRole("list", { name: "Your platforms" });
      fireEvent.click(
        within(list).getByRole("button", { name: /somm\.finance/ }),
      );

      expect(push).toHaveBeenCalledWith("/projects?platform=somm.finance");
      expect(scopedCalls()).toBe(0);
    });

    it("falls back to the typed name when the list cannot be read", async () => {
      respond({ scoped: () => ({ projects: [] }) });
      renderSwitcher("community");

      await waitFor(() =>
        expect(
          screen.queryByRole("list", { name: "Your platforms" }),
        ).not.toBeInTheDocument(),
      );
      const input = screen.getByRole("textbox", { name: "Platform name" });
      fireEvent.change(input, { target: { value: "somm.finance" } });
      fireEvent.click(screen.getByRole("button", { name: "Switch" }));

      await waitFor(() =>
        expect(push).toHaveBeenCalledWith("/projects?platform=somm.finance"),
      );
    });
  });

  describe("the exact-name fallback", () => {
    it("switches only after an exact platform source lookup succeeds", async () => {
      const result = { projects: [] };
      respond({ list: projectsOn(), scoped: () => result });
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
      respond({
        list: projectsOn(),
        scoped: () => {
          throw new LaunchRequestError("deployment projects failed", 404, {});
        },
      });
      renderSwitcher("community");
      const input = screen.getByRole("textbox", { name: "Platform name" });

      fireEvent.change(input, { target: { value: "missing.partner" } });
      fireEvent.click(screen.getByRole("button", { name: "Switch" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Platform not found. Nothing changed",
      );
      expect(push).not.toHaveBeenCalled();
    });

    it("disables Switch until a platform name is entered", () => {
      respond({ list: projectsOn() });
      renderSwitcher();

      expect(screen.getByRole("button", { name: "Switch" })).toBeDisabled();
    });
  });

  it("explains Community where it is offered", async () => {
    respond({ list: projectsOn("somm.finance") });
    renderSwitcher("somm.finance");

    await screen.findByRole("list", { name: "Your platforms" });
    expect(
      screen.getByRole("button", { name: "What is Community?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Aomi's default platform",
    );
  });
});
