import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

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

import { GitHubSessionProvider } from "@build/components/control-plane/github-session-context";
import { useProjectDetail } from "./use-project-detail";
import {
  deploymentRecords,
  deploymentHistory,
  deploymentSecrets,
  deploymentSetSecrets,
  deploymentRequiredSecrets,
  deploymentProjects,
  launchDeploy,
  launchPreflight,
  launchActivate,
  launchStatus,
} from "@build/features/launch/client";

// Fresh QueryClient per test so react-query cache never leaks across tests.
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(GitHubSessionProvider, null, children),
    );
  };
}

describe("useProjectDetail", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("refreshes the source before gating a redeploy on required secrets", async () => {
    // Preflight re-syncs the source from the repo, so it can register an app
    // the page never saw. The gate then fails for that app — and the banner and
    // Environment tab list apps from `source`, so a stale source leaves the
    // user with a missing-secret error and nowhere to enter the value.
    vi.mocked(deploymentProjects)
      .mockResolvedValueOnce({
        projects: [
          {
            id: 7,
            installationId: 5,
            repositoryLink: "a/b",
            platformName: "community",
            apps: [{ name: "my-bot" }],
            latestDeployment: null,
          },
        ],
      } as never)
      .mockResolvedValue({
        projects: [
          {
            id: 7,
            installationId: 5,
            repositoryLink: "a/b",
            platformName: "community",
            apps: [{ name: "my-bot" }, { name: "my-bot-2" }],
            latestDeployment: null,
          },
        ],
      } as never);
    vi.mocked(launchPreflight).mockResolvedValue({
      ok: true,
      projectId: 7,
      sourceRef: "abc1234",
      apps: ["my-bot", "my-bot-2"],
    } as never);
    vi.mocked(deploymentRequiredSecrets).mockResolvedValue({
      byApp: {
        "my-bot": { applicationId: 19, slots: [], missing: [] },
        "my-bot-2": {
          slots: [
            {
              name: "TELEGRAM_BOT_TOKEN",
              description: "Token from BotFather.",
              required: true,
            },
          ],
          missing: ["TELEGRAM_BOT_TOKEN"],
        },
      },
    });

    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.apps).toHaveLength(1));

    await act(async () => {
      await result.current.redeploySource();
    });

    expect(result.current.deployFlow).toMatchObject({
      phase: "error",
      message: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
    });
    // The newly registered app is visible, so the gate banner and the
    // Environment tab can offer somewhere to set the token.
    expect(result.current.source?.apps.map((app) => app.name)).toContain(
      "my-bot-2",
    );
    expect(launchDeploy).not.toHaveBeenCalled();
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

  it("keeps the CI run link when the first poll already reports failure", async () => {
    vi.mocked(launchPreflight).mockResolvedValue({
      projectId: 7,
      sourceRef: "abc1234",
      apps: ["my-bot"],
    } as never);
    vi.mocked(deploymentRequiredSecrets).mockResolvedValue({ byApp: {} });
    vi.mocked(launchDeploy).mockResolvedValue({
      deployment: { id: "dep_1" },
      releaseTags: ["my-bot-r1"],
      apps: ["my-bot"],
    } as never);
    // `waitForDeploymentReady` throws on a terminal status *before* it reports
    // progress, so the url has to be captured at the poll, not in onProgress.
    vi.mocked(launchStatus).mockResolvedValue({
      state: "failed",
      releaseTags: [],
      message: "Deploy CI failed.",
      ci: { url: "https://github.com/a/b/actions/runs/1" },
    } as never);

    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));

    await act(async () => {
      await result.current.redeploySource();
    });

    await waitFor(() =>
      expect(result.current.deployFlow).toMatchObject({
        phase: "error",
        message: "Deploy CI failed.",
        progress: { ciUrl: "https://github.com/a/b/actions/runs/1" },
      }),
    );
  });

  it("keeps a candidate release's 409 requirements visible and editable", async () => {
    vi.mocked(launchPreflight).mockResolvedValue({
      projectId: 7,
      sourceRef: "abc1234",
      apps: ["my-bot"],
    } as never);
    vi.mocked(deploymentRequiredSecrets).mockResolvedValue({ byApp: {} });
    vi.mocked(launchDeploy).mockResolvedValue({
      deployment: { id: "dep_1" },
      releaseTags: ["my-bot-r1"],
      apps: ["my-bot"],
    } as never);
    vi.mocked(launchStatus).mockResolvedValue({
      state: "ready",
      releaseTags: ["my-bot-r1"],
    } as never);
    vi.mocked(launchActivate).mockRejectedValue(
      Object.assign(new Error("missing required secrets"), {
        status: 409,
        body: { missing: { "my-bot": ["PROVIDER_API_KEY"] } },
      }),
    );

    const { result } = renderHook(() => useProjectDetail(7), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.source?.id).toBe(7));

    await act(async () => {
      await result.current.redeploySource();
    });

    await waitFor(() =>
      expect(result.current.deployFlow).toMatchObject({
        phase: "error",
        message: expect.stringContaining("Set them in Environment"),
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
