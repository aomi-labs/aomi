import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@build/components/control-plane/toast";

const searchParams = { current: new URLSearchParams("") };
const { push, useProjectDetail } = vi.hoisted(() => ({
  push: vi.fn(),
  useProjectDetail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  useRouter: () => ({ push }),
}));

vi.mock("@build/features/operate/client", () => ({
  operateFetch: vi.fn(async () => ({ daily: [] })),
}));

// The page warms its reads through the shared prefetch on mount; keep the
// test offline instead of letting prefetchQuery hit real clients.
vi.mock("@build/components/control-plane/prefetch-control-plane-route", () => ({
  prefetchProjectDetail: vi.fn(),
}));

vi.mock("@aomi-labs/deploy/lifecycle", () => ({
  deploymentLifecycleFromProject: () => ({
    kind: "empty",
    repo: "a/b",
    statusLabel: "No deployment",
    statusTone: "muted",
    message: "No deployment recorded yet.",
    appNames: [],
    releaseTags: [],
  }),
}));

vi.mock("@build/features/launch/hooks/use-project-detail", () => ({
  useProjectDetail: (...args: unknown[]) => {
    useProjectDetail(...args);
    return {
      source: {
        id: 1,
        repositoryLink: "a/b",
        platformName: "somm.finance",
        apps: [],
        latestDeployment: null,
        installationId: 5,
      },
      loading: false,
      error: null,
      sdk: null,
      history: null,
      historyError: null,
      secretsByApp: {},
      secretsError: null,
      requiredSecrets: null,
      requiredSecretsError: null,
      loadRequiredSecrets: vi.fn(),
      hasMissingSecrets: () => false,
      recordsByApp: {},
      recordsError: null,
      attempts: { attempts: [], local: [], busy: false, isSuccess: true },
      deployFlow: { phase: "idle" },
      loadHistory: vi.fn(),
      loadSecrets: vi.fn(),
      loadRecords: vi.fn(),
      rollback: vi.fn(),
      reload: vi.fn(),
      redeploySource: vi.fn(),
      upgradeSdk: vi.fn(),
      promote: vi.fn(),
      deactivate: vi.fn(),
    };
  },
}));

import { ProjectPage } from "./project-page";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectPage projectId={1} tabBaseHref="/projects/1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectPage", () => {
  beforeEach(() => {
    searchParams.current = new URLSearchParams("");
    push.mockReset();
    useProjectDetail.mockReset();
  });

  it("defaults to the Home tab", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: /^home$/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Project home")).toBeInTheDocument();
  });

  it("renders the tab named by ?tab=", () => {
    searchParams.current = new URLSearchParams("tab=deployments");
    renderPage();
    const projectTabs = screen.getAllByRole("tablist")[0];
    expect(
      within(projectTabs).getByRole("tab", { name: /^deployments$/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Project home")).not.toBeInTheDocument();
  });

  it("uses canonical Project identity in reads and tab links", () => {
    renderPage();

    expect(useProjectDetail).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("tab", { name: /^deployments$/i }));
    expect(push).toHaveBeenCalledWith(
      "/projects/1?tab=deployments&platform=somm.finance",
    );
  });
});
