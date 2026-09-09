import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const attemptMocks = vi.hoisted(() => ({
  start: vi.fn(async () => ({ id: 123 })),
  push: vi.fn(),
  attempts: [] as Array<{ id: number; status: string; conclusion: unknown }>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: attemptMocks.push }),
}));
vi.mock("./use-deployment-attempts", () => ({
  useDeploymentAttempts: () => ({
    attempts: attemptMocks.attempts,
    start: attemptMocks.start,
  }),
}));
vi.mock("@build/features/launch/dashboard", () => ({
  fetchGitHubSession: vi.fn(async () => ({
    signedIn: true,
    githubLogin: "alice",
    githubUserId: "u1",
  })),
}));

vi.mock("@build/features/launch/client", () => ({
  deploymentProjects: vi.fn(async () => ({
    projects: [
      {
        id: 7,
        installationId: 5,
        repositoryLink: "a/b",
        platformName: "community",
        apps: [{ id: 17, name: "my-bot" }],
        latestDeployment: null,
      },
    ],
  })),
  deploymentSdkStatus: vi.fn(async () => null),
  deploymentHistory: vi.fn(async () => ({
    deployments: [
      {
        deploymentId: "dep_1",
        apps: [],
        releaseTags: [],
        state: "recorded",
        createdAt: 1,
      },
    ],
  })),
  deploymentSecrets: vi.fn(async () => ({
    byApp: { demo: ["$SECRET:APP:demo::KEY"] },
  })),
  deploymentRequiredSecrets: vi.fn(async () => ({
    byApp: {},
  })),
  deploymentPromote: vi.fn(),
  deploymentDeactivate: vi.fn(async () => ({ ok: true, apps: ["my-bot"] })),
  launchAppsStatus: vi.fn(async () => ({ apps: [], state: "pending" })),
  launchPreflight: vi.fn(),
  launchDeploy: vi.fn(),
  launchStatus: vi.fn(),
  launchActivate: vi.fn(),
  deploymentSetSecrets: vi.fn(async () => ({ ok: true, keys: [] })),
  deploymentRecords: vi.fn(async () => ({
    app: "my-bot",
    currentReleaseTag: "tag-b",
    records: [
      {
        deploymentId: "dep_b",
        releaseTag: "tag-b",
        sdkVersion: "3.0.1",
        actor: null,
        createdAt: 2,
        current: true,
      },
      {
        deploymentId: "dep_a",
        releaseTag: "tag-a",
        sdkVersion: "3.0.1",
        actor: null,
        createdAt: 1,
        current: false,
      },
    ],
  })),
}));

import { LaunchRequestError } from "@aomi-labs/deploy/launch";
import { GitHubSessionProvider } from "@build/components/control-plane/github-session-context";
import { useProjectDetail } from "./use-project-detail";
import { projectDeploymentStatus } from "../components/deployments/project-deployment-status";
import {
  deploymentRecords,
  deploymentHistory,
  deploymentSecrets,
  deploymentSetSecrets,
  deploymentRequiredSecrets,
  deploymentProjects,
  launchAppsStatus,
  launchDeploy,
  launchPreflight,
  launchActivate,
  launchStatus,
} from "@build/features/launch/client";

// Fresh QueryClient per test so react-query cache never leaks across tests.
function wrapper(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(GitHubSessionProvider, null, children),
    );
  };
}

// An active app so the runtime probe query is enabled; `loaded` is the
// Manager's own flag before any probe has answered.
function activeProject(loaded: boolean) {
  return {
    projects: [
      {
        id: 7,
        installationId: 5,
        repositoryLink: "a/b",
        platformName: "community",
        apps: [
          {
            id: 17,
            name: "my-bot",
            isActive: true,
            loaded,
            appReleaseTag: "t1",
          },
        ],
        latestDeployment: null,
      },
    ],
  };
}
const RUNTIME_KEY = ["project-runtime", "alice", 7];

describe("useProjectDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attemptMocks.attempts = [];
  });

  it("resolves the source and lazily loads history once", async () => {
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));
    expect(deploymentHistory).not.toHaveBeenCalled();
    act(() => result.current.loadHistory());
    act(() => result.current.loadHistory());
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(deploymentHistory).toHaveBeenCalledTimes(1);
    expect(deploymentSecrets).not.toHaveBeenCalled();
  });

  it("lazily loads records per app once", async () => {
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));
    expect(deploymentRecords).not.toHaveBeenCalled();
    act(() => result.current.loadRecords());
    act(() => result.current.loadRecords());
    await waitFor(() =>
      expect(result.current.recordsByApp?.["my-bot"]).toHaveLength(2),
    );
    expect(deploymentRecords).toHaveBeenCalledTimes(1);
    expect(deploymentRecords).toHaveBeenCalledWith({
      app: "my-bot",
      projectId: 7,
    });
  });

  it("surfaces record load failures instead of silently emptying logs", async () => {
    vi.mocked(deploymentRecords).mockRejectedValueOnce(
      new Error("deployment activations failed (401)"),
    );
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));
    act(() => result.current.loadRecords());
    await waitFor(() =>
      expect(result.current.recordsError).toContain(
        "deployment activations failed",
      ),
    );
    expect(result.current.recordsByApp).toEqual({});
  });

  it("surfaces history load failures and allows retry", async () => {
    vi.mocked(deploymentHistory)
      .mockRejectedValueOnce(new Error("history failed (401)"))
      .mockResolvedValueOnce({
        deployments: [
          {
            deploymentId: "dep_retry",
            apps: [],
            releaseTags: [],
            state: "recorded",
            createdAt: 1,
          },
        ],
      });
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));

    act(() => result.current.loadHistory());
    await waitFor(() =>
      expect(result.current.historyError).toContain("history failed"),
    );
    expect(result.current.history).toBeNull();

    act(() => result.current.loadHistory());
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(result.current.historyError).toBeNull();
  });

  it("surfaces secret load failures and allows retry", async () => {
    vi.mocked(deploymentSecrets)
      .mockRejectedValueOnce(new Error("vault failed (401)"))
      .mockResolvedValueOnce({
        byApp: { demo: ["$SECRET:APP:demo::KEY"] },
      });
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));

    act(() => result.current.loadSecrets());
    await waitFor(() =>
      expect(result.current.secretsError).toContain("vault failed"),
    );
    expect(result.current.secretsByApp).toBeNull();

    act(() => result.current.loadSecrets());
    await waitFor(() =>
      expect(result.current.secretsByApp?.demo).toHaveLength(1),
    );
    expect(result.current.secretsError).toBeNull();
  });

  it("exposes the missing required secrets per app", async () => {
    vi.mocked(deploymentRequiredSecrets).mockResolvedValue({
      byApp: {
        binance: {
          applicationId: 17,
          slots: [],
          missing: ["BINANCE_SECRET_KEY"],
        },
      },
    });
    const { result } = renderHook(() => useProjectDetail(42), {
      wrapper: wrapper(),
    });
    act(() => result.current.loadRequiredSecrets());
    await waitFor(() => expect(result.current.requiredSecrets).not.toBeNull());
    expect(result.current.hasMissingSecrets("binance")).toBe(true);
    expect(result.current.hasMissingSecrets("hello")).toBe(false);
  });

  it("surfaces a required-secrets load failure instead of a false empty state", async () => {
    vi.mocked(deploymentRequiredSecrets).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useProjectDetail(42), {
      wrapper: wrapper(),
    });
    act(() => result.current.loadRequiredSecrets());
    await waitFor(() =>
      expect(result.current.requiredSecretsError).toBe("boom"),
    );
    expect(result.current.requiredSecrets).toBeNull();
  });

  it("shows Activated until the runtime verifies the Manager's active release", async () => {
    vi.mocked(deploymentProjects).mockResolvedValueOnce(activeProject(true));
    vi.mocked(launchAppsStatus).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(launchAppsStatus).toHaveBeenCalled());
    expect(result.current.source?.apps[0]?.loaded).toBeUndefined();
    expect(projectDeploymentStatus(result.current.source!)).toMatchObject({
      label: "Activated",
      isLive: false,
    });
  });

  it("keeps the last probe result and keeps polling after a runtime error", async () => {
    vi.mocked(deploymentProjects).mockResolvedValueOnce(activeProject(false));
    vi.mocked(launchAppsStatus)
      .mockResolvedValueOnce({
        apps: [
          {
            id: 17,
            name: "my-bot",
            is_active: true,
            loaded: true,
            app_release_tag: "t1",
          },
        ],
        state: "live",
      })
      .mockRejectedValue(
        new LaunchRequestError("runtime down", 502, { retryable: false }),
      );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(result.current.source?.apps[0]?.loaded).toBe(true),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: RUNTIME_KEY });
    });
    // The hook only reads `data`, so an error refetch keeps the last probe
    // result: observe the query state through the cache.
    const runtimeQuery = () =>
      client.getQueryCache().find({ queryKey: RUNTIME_KEY });
    await waitFor(() => expect(runtimeQuery()?.state.status).toBe("error"));
    expect(result.current.source?.apps[0]?.loaded).toBe(true);
    expect(runtimeQuery()?.options.refetchInterval).toBe(10000);

    vi.mocked(launchAppsStatus).mockResolvedValueOnce({
      apps: [
        {
          id: 17,
          name: "my-bot",
          is_active: true,
          loaded: false,
          app_release_tag: "t1",
        },
      ],
      state: "pending",
    });
    await act(async () => {
      await client.refetchQueries({ queryKey: RUNTIME_KEY });
    });
    await waitFor(() =>
      expect(result.current.source?.apps[0]?.loaded).toBe(false),
    );
    expect(projectDeploymentStatus(result.current.source!).isLive).toBe(false);
  });

  it("does not claim Live when the first runtime probe fails", async () => {
    vi.mocked(deploymentProjects).mockResolvedValueOnce(activeProject(true));
    vi.mocked(launchAppsStatus).mockRejectedValueOnce(
      new LaunchRequestError("runtime down", 503, { retryable: false }),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(client.getQueryState(RUNTIME_KEY)?.status).toBe("error"),
    );
    expect(projectDeploymentStatus(result.current.source!)).toMatchObject({
      label: "Activated",
      isLive: false,
    });
  });

  it("invalidates the runtime query once when the latest attempt completes, not on first load", async () => {
    vi.mocked(deploymentProjects).mockResolvedValue(activeProject(false));
    attemptMocks.attempts = [
      { id: 1, status: "completed", conclusion: "success" },
    ];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const runtimeInvalidations = () =>
      invalidate.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) === JSON.stringify(RUNTIME_KEY),
      );
    const { result, rerender } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));
    expect(deploymentProjects).toHaveBeenCalledTimes(1);
    expect(runtimeInvalidations()).toHaveLength(0);

    attemptMocks.attempts = [
      { id: 2, status: "in_progress", conclusion: null },
    ];
    rerender();
    expect(runtimeInvalidations()).toHaveLength(0);

    attemptMocks.attempts = [
      { id: 2, status: "completed", conclusion: "success" },
    ];
    rerender();
    await waitFor(() => expect(runtimeInvalidations()).toHaveLength(1));
    rerender();
    expect(runtimeInvalidations()).toHaveLength(1);
    await waitFor(() => expect(deploymentProjects).toHaveBeenCalledTimes(2));
  });

  it("starts the selected branch and moves progress to the project immediately", async () => {
    let acknowledge!: (value: { id: number }) => void;
    attemptMocks.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));
    let operation!: Promise<unknown>;
    act(() => {
      operation = result.current.redeploySource("release/fix");
    });
    expect(attemptMocks.start).toHaveBeenCalledWith("release/fix");
    expect(attemptMocks.push).toHaveBeenCalledWith(
      "/projects/7?tab=deployments&platform=community",
    );
    expect(launchDeploy).not.toHaveBeenCalled();
    expect(launchActivate).not.toHaveBeenCalled();
    await act(async () => {
      acknowledge({ id: 123 });
      await operation;
    });
  });

  it("surfaces direct required-secret check failures for a redeploy target", async () => {
    vi.mocked(deploymentRequiredSecrets).mockRejectedValueOnce(
      new Error("manifest unavailable"),
    );
    const { result } = renderHook(() => useProjectDetail(42), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await expect(
        result.current.ensureRequiredSecrets(["binance"], 99),
      ).rejects.toThrow("manifest unavailable");
    });
    await waitFor(() =>
      expect(result.current.requiredSecretsError).toBe("manifest unavailable"),
    );
  });

  it("keeps a candidate release's 409 requirements visible and editable", async () => {
    vi.mocked(deploymentRequiredSecrets).mockResolvedValue({ byApp: {} });
    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));

    act(() =>
      result.current.noteMissingRequiredSecrets({
        "my-bot": ["PROVIDER_API_KEY"],
      }),
    );
    expect(result.current.requiredSecrets?.["my-bot"]).toMatchObject({
      applicationId: 17,
      missing: ["PROVIDER_API_KEY"],
      slots: [
        {
          name: "PROVIDER_API_KEY",
          required: true,
          description: "Required by the deployment that was blocked.",
        },
      ],
    });

    vi.mocked(deploymentSetSecrets).mockResolvedValue({
      ok: true,
      keys: ["PROVIDER_API_KEY"],
    });
    vi.mocked(deploymentSecrets).mockResolvedValue({
      byApp: { "my-bot": ["$SECRET:APP:my-bot::PROVIDER_API_KEY"] },
    });
    await act(async () => {
      await result.current.setEnvVars(17, { PROVIDER_API_KEY: "secret" });
    });
    await waitFor(() =>
      expect(result.current.hasMissingSecrets("my-bot")).toBe(false),
    );
    expect(
      window.sessionStorage.getItem(
        "aomi-build:project:7:candidate-required-secrets",
      ),
    ).toBeNull();
  });
});
