import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
  type RouterHistory,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UrlLink } from "./components/url-link";
import { NewProject } from "./features/deploy/components/deployments/new-project";
import { newProjectMode } from "./features/deploy/new-project-mode";
import { platformParam } from "./features/deploy/platform";
import type { ReactElement } from "react";
import type { LaunchProgress } from "./features/deploy";
import { OperateView } from "./features/operate/operate-view";
import { parseUrlSearch, stringifyUrlSearch } from "./lib/url-search";

vi.unmock("@tanstack/react-router");
vi.mock("./features/deploy/dashboard", () => ({
  fetchGitHubSession: async () => ({
    signedIn: true,
    githubLogin: "alice",
    installationId: "42",
  }),
  GITHUB_SIGNIN_URL: "/api/bff/auth/github/login",
}));
vi.mock(
  "./features/deploy/components/deployments/repository-connector",
  () => ({
    RepositoryConnector: () => <p>Repository connector</p>,
  }),
);
vi.mock("./features/deploy/components/oneshot-wizard", () => ({
  OneshotWizard: ({
    progress,
    patch,
    onRestart,
  }: {
    progress: LaunchProgress;
    patch: (patch: Partial<LaunchProgress>) => void;
    onRestart: () => void;
  }) => (
    <>
      <p>Installation {progress.installationId}</p>
      <button onClick={() => patch({ deploymentId: "deploy-1" })}>
        Record deployment
      </button>
      <button onClick={onRestart}>Restart deployment</button>
    </>
  ),
}));
vi.mock("./components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({
    account: { loading: false, signedIn: true, githubLogin: "alice" },
  }),
}));
vi.mock("./features/operate/client", () => ({
  operateFetch: async () => ({
    projects: [],
    logs: [
      {
        id: "log-1",
        application: "agent",
        eventType: "error",
        occurredAt: 1700000000,
        summary: "Tool call failed",
      },
    ],
    nextCursor: null,
  }),
  operatePaymentsFetch: async () => ({ payments: null }),
}));

let activeHistory: RouterHistory | undefined;

function LocationProbe() {
  const href = useLocation({ select: (location) => location.href });
  return <output data-testid="router-location">{href}</output>;
}

async function mountRouter(href: string) {
  window.history.replaceState(null, "", href);
  const history = createBrowserHistory();
  activeHistory = history;
  history.replace(href, {
    ...history.location.state,
    campaign: "local-review",
  });
  history.flush();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <UrlLink href="/projects">Open projects</UrlLink>
        <LocationProbe />
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const newProjectRoute = createRoute({
    getParentRoute: () => root,
    path: "/operate/deployments/new",
    validateSearch: (search: Record<string, unknown>) =>
      search as Record<string, string | string[] | undefined>,
    component: NewProjectPage,
  });
  function NewProjectPage(): ReactElement {
    const search = newProjectRoute.useSearch<typeof router>();
    return (
      <NewProject
        platform={platformParam(search.platform)}
        mode={newProjectMode(search.mode)}
      />
    );
  }
  const router = createRouter({
    routeTree: root.addChildren([
      newProjectRoute,
      createRoute({
        getParentRoute: () => root,
        path: "/operate/logs",
        component: () => <OperateView kind="logs" />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/projects",
        component: () => <p>Project list</p>,
      }),
    ]),
    history,
    parseSearch: parseUrlSearch,
    stringifySearch: stringifyUrlSearch,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("Build router-owned URL replacements", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    activeHistory?.destroy();
    activeHistory = undefined;
  });

  it("keeps a selected starting mode and history metadata through back and forward", async () => {
    const router = await mountRouter(
      "/operate/deployments/new?platform=community&tag=a&tag=b#start",
    );
    const index = router.history.location.state.__TSR_index;
    const length = window.history.length;
    fireEvent.click(
      await screen.findByRole("button", { name: /Import from GitHub/ }),
    );
    await screen.findByText("Repository connector");
    await waitFor(() =>
      expect(router.state.location.search.mode).toBe("import"),
    );
    expect(router.state.location.search.tag).toEqual(["a", "b"]);
    expect(router.state.location.hash).toBe("start");
    expect(router.history.location.state).toMatchObject({
      __TSR_index: index,
      campaign: "local-review",
    });
    expect(router.history.location.state.__TSR_key).toBeTruthy();
    expect(window.history.length).toBe(length);
    fireEvent.click(screen.getByRole("link", { name: "Open projects" }));
    await screen.findByText("Project list");
    expect(router.history.location.state.__TSR_index).toBe(index + 1);
    act(() => router.history.back());
    await screen.findByText("Repository connector");
    expect(router.state.location.search.mode).toBe("import");
    expect(router.history.location.state.__TSR_index).toBe(index);
    act(() => router.history.forward());
    await screen.findByText("Project list");
    expect(router.history.location.state.__TSR_index).toBe(index + 1);
  });

  it("cleans GitHub return parameters and records or removes deployment ids without losing other URL state", async () => {
    const router = await mountRouter(
      "/operate/deployments/new?mode=template&platform=community&installation_id=99&launch=bound&tag=a&tag=b#start",
    );
    const index = router.history.location.state.__TSR_index;
    await screen.findByText("Installation 99");
    await waitFor(() =>
      expect(router.state.location.search.installation_id).toBeUndefined(),
    );
    expect(router.state.location.search.launch).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Record deployment" }));
    await waitFor(() =>
      expect(router.state.location.search.deployment_id).toBe("deploy-1"),
    );
    expect(router.state.location.search.deploy_path).toBe("oneshot");
    fireEvent.click(screen.getByRole("button", { name: "Restart deployment" }));
    await waitFor(() =>
      expect(router.state.location.search.deployment_id).toBeUndefined(),
    );
    expect(router.state.location.search.deploy_path).toBeUndefined();
    expect(router.state.location.search.tag).toEqual(["a", "b"]);
    expect(router.state.location.hash).toBe("start");
    expect(router.history.location.state).toMatchObject({
      __TSR_index: index,
      campaign: "local-review",
    });
    expect(router.history.location.state.__TSR_key).toBeTruthy();
    expect(
      new URL(window.location.href).searchParams.has("deployment_id"),
    ).toBe(false);
  });

  it("updates router-observed log filters and preserves them on return navigation", async () => {
    const router = await mountRouter("/operate/logs?platform=community#logs");
    const index = router.history.location.state.__TSR_index;
    fireEvent.click(await screen.findByRole("button", { name: "Errors only" }));
    await waitFor(() => expect(router.state.location.search.errors).toBe("1"));
    expect(screen.getByTestId("router-location")).toHaveTextContent("errors=1");
    expect(router.history.location.state.__TSR_index).toBe(index);
    expect(router.state.location.hash).toBe("logs");
    fireEvent.click(screen.getByRole("link", { name: "Open projects" }));
    await screen.findByText("Project list");
    act(() => router.history.back());
    await screen.findByRole("button", { name: "Errors only" });
    expect(router.state.location.search.errors).toBe("1");
    expect(router.history.location.state.__TSR_index).toBe(index);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(router.state.location.search.errors).toBeUndefined(),
    );
    expect(router.state.location.search.platform).toBe("community");
  });
});
