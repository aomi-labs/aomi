import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { ToastProvider } from "@build/components/control-plane/toast";
import type { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";
import { DeploymentsTab } from "./deployments-tab";

type Detail = ReturnType<typeof useProjectDetail>;

function renderTab(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const promote = vi.fn(async () => ({
  ok: true,
  promote: {
    deploymentId: "dep_1_ra_bbbb",
    releaseTags: ["t1"],
    status: "promoted",
  },
}));
const deactivate = vi.fn(async () => ({ ok: true, apps: ["my-bot"] }));

/** Builds the `detail` prop DeploymentsTab expects. Defaults have no
 *  required-secret gaps; pass `hasMissingSecrets` to simulate one. */
function makeDetail(
  overrides: {
    hasMissingSecrets?: (app: string) => boolean;
    sdkVersion?: string;
    requiredSdk?: string;
    upgradeSdk?: ReturnType<typeof vi.fn>;
    checkSdkUpgradeStatus?: ReturnType<typeof vi.fn>;
    history?: Detail["history"];
    recordsByApp?: Detail["recordsByApp"];
    deployFlow?: Detail["deployFlow"];
  } = {},
) {
  const sdkVersion = overrides.sdkVersion ?? "3.0.1";
  return {
    source: {
      id: 1,
      repositoryLink: "a/b",
      apps: [
        {
          name: "my-bot",
          isActive: true,
          loaded: true,
          appReleaseTag: "t-current",
        },
      ],
    },
    attempts: {
      attempts: [],
      local: [],
      busy: false,
      isSuccess: true,
      refetch: vi.fn(),
    },
    loading: false,
    sdk: {
      sdkStatus: { requiredVersion: overrides.requiredSdk ?? "3.0.1" },
    },
    loadRecords: vi.fn(),
    loadRequiredSecrets: vi.fn(),
    loadHistory: vi.fn(),
    history: "history" in overrides ? overrides.history : [],
    historyError: null,
    refreshRequiredSecrets: vi.fn(async () => ({})),
    hasMissingSecrets: overrides.hasMissingSecrets ?? (() => false),
    refreshRecords: vi.fn(),
    redeploySource: vi.fn(),
    upgradeSdk:
      overrides.upgradeSdk ??
      vi.fn(async () => ({
        status: "current",
        requiredSdkVersion: "3.0.1",
        sourceRef: "abc1234",
      })),
    checkSdkUpgradeStatus:
      overrides.checkSdkUpgradeStatus ??
      vi.fn(async () => ({
        status: "open",
        requiredSdkVersion: "3.0.1",
        branch: "aomi/sdk-3.0.1",
        pullRequest: {
          number: 7,
          url: "https://github.com/alice/bot/pull/7",
          state: "open",
          merged: false,
        },
      })),
    deployFlow: overrides.deployFlow ?? { phase: "idle" },
    deployStartedAt: null,
    recordsByApp:
      overrides.recordsByApp ??
      ({
        "my-bot": [
          {
            deploymentId: "dep_1_ra_currentcmt",
            releaseTag: "t-current",
            actor: "alice",
            createdAt: 200,
            sdkVersion,
            current: true,
          },
          {
            deploymentId: "dep_1_ra_oldcommit1",
            releaseTag: "t-old",
            actor: "alice",
            createdAt: 100,
            sdkVersion,
            current: false,
          },
        ],
      } satisfies Detail["recordsByApp"]),
    promote,
    deactivate,
    reload: vi.fn(),
  } as unknown as ReturnType<
    typeof import("@build/features/launch/hooks/use-project-detail").useProjectDetail
  >;
}

const detail = makeDetail();

describe("DeploymentsTab", () => {
  // The upgrade rail persists PR state and the confirm-skip preference in
  // localStorage; isolate every test from the previous one's flow.
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders deployments from the DB timeline, current first", async () => {
    renderTab(<DeploymentsTab detail={detail} />);
    expect(detail.loadHistory).toHaveBeenCalled();
    expect(detail.loadRecords).toHaveBeenCalled();
    expect(
      await screen.findByText(/Live · my-bot · 2 deployments/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("my-bot").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("dep_1_ra_currentcmt").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("dep_1_ra_oldcommit1").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /promotions/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("does not label a records-only snapshot as deactivated", () => {
    const partial = makeDetail({
      history: null,
      recordsByApp: {
        "my-bot": [
          {
            deploymentId: "dep_1_ra_oldcommit1",
            releaseTag: "t-old",
            actor: "alice",
            createdAt: 100,
            sdkVersion: "3.0.1",
            current: false,
          },
        ],
      },
    });
    renderTab(<DeploymentsTab detail={partial} />);
    expect(
      screen.getByText("Live · 1 deployment in history"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No deployment is currently live/i)).toBeNull();
  });

  it("renders history when the promotion log is empty", async () => {
    const historyOnly = makeDetail({
      recordsByApp: { "my-bot": [] },
      history: [
        {
          deploymentId: "dep_1_ra_sommcommit",
          state: "ready",
          deployBranch: "alice/somm/1/sommcommit",
          platformRepo: "aomi-labs/somm-finance-apps",
          commitHash: "sommcommit00000000000000000000000000000",
          ciStatus: "passed",
          ciUrl: null,
          releaseTags: ["t-current"],
          sdkVersion: "3.0.4",
          createdAt: 200,
          apps: [{ name: "my-bot", releaseTag: "t-current" }],
        },
      ],
    });

    renderTab(<DeploymentsTab detail={historyOnly} />);

    expect(
      await screen.findByText(/Live · my-bot · 1 deployment in history/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("dep_1_ra_sommcommit").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/No deployment history yet/i)).toBeNull();
  });

  it("renders promotion activity in the Promotions subtab", async () => {
    renderTab(<DeploymentsTab detail={detail} />);
    fireEvent.click(screen.getByRole("tab", { name: /promotions/i }));
    expect(screen.getByRole("tab", { name: /promotions/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect((await screen.findAllByText(/promoted ·/)).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("dep_1_ra_currentcmt").length).toBeGreaterThan(
      0,
    );
  });
  it("offers Deactivate in the toolbar and Promote on older deployments", () => {
    renderTab(<DeploymentsTab detail={detail} />);
    expect(
      screen.getByRole("button", { name: /deactivate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /promote/i }),
    ).toBeInTheDocument();
  });

  it("confirms before promoting an older deployment", async () => {
    renderTab(<DeploymentsTab detail={detail} />);
    fireEvent.click(screen.getByRole("button", { name: /promote/i }));
    expect(promote).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /promote deployment/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /promote/i }));
    await waitFor(() =>
      expect(promote).toHaveBeenCalledWith("dep_1_ra_oldcommit1"),
    );
  });

  it("confirms before deactivating the current deployment", async () => {
    renderTab(<DeploymentsTab detail={detail} />);
    fireEvent.click(screen.getByRole("button", { name: /deactivate/i }));
    expect(deactivate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: /deactivate deployment/i,
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /deactivate/i }),
    );
    await waitFor(() => expect(deactivate).toHaveBeenCalledWith(["my-bot"]));
  });

  it("shows a deactivated state and makes the previous current deployment promotable", async () => {
    renderTab(<DeploymentsTab detail={detail} />);
    fireEvent.click(screen.getByRole("button", { name: /deactivate/i }));
    const dialog = screen.getByRole("dialog", {
      name: /deactivate deployment/i,
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /deactivate/i }),
    );

    await screen.findByText(/No deployment is currently live/i);

    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /promote/i })).toHaveLength(2);
  });

  it("redeploys from the linked repository", () => {
    renderTab(<DeploymentsTab detail={detail} />);
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(detail.redeploySource).toHaveBeenCalled();
  });

  const pullRequestResult = {
    status: "pull_request" as const,
    requiredSdkVersion: "3.0.3",
    sourceRef: "abc1234",
    branch: "aomi/sdk-3.0.3",
    files: ["Cargo.toml"],
    pullRequest: {
      number: 7,
      url: "https://github.com/alice/bot/pull/7",
      created: true,
    },
  };

  it("confirms, opens an SDK upgrade PR, and gates redeploy on the merge", async () => {
    const upgradeSdk = vi.fn(async () => pullRequestResult);
    const outdated = makeDetail({
      sdkVersion: "3.0.2",
      requiredSdk: "3.0.3",
      upgradeSdk,
    });
    renderTab(<DeploymentsTab detail={outdated} />);

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to 3\.0\.3/i }),
    );
    // Nothing happens until the builder confirms the plan.
    expect(upgradeSdk).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: /open an upgrade pull request/i,
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /open upgrade pr/i }),
    );

    const links = await screen.findAllByRole("link", {
      name: /review pr #7/i,
    });
    expect(links[0]).toHaveAttribute(
      "href",
      "https://github.com/alice/bot/pull/7",
    );
    expect(upgradeSdk).toHaveBeenCalledOnce();
    // The Upgrade button is gone (one CTA per intent) and redeploy is gated.
    expect(
      screen.queryByRole("button", { name: /upgrade to 3\.0\.3/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });

  it("does nothing when the upgrade confirm is cancelled", () => {
    const upgradeSdk = vi.fn(async () => pullRequestResult);
    const outdated = makeDetail({
      sdkVersion: "3.0.2",
      requiredSdk: "3.0.3",
      upgradeSdk,
    });
    renderTab(<DeploymentsTab detail={outdated} />);

    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to 3\.0\.3/i }),
    );
    const dialog = screen.getByRole("dialog", {
      name: /open an upgrade pull request/i,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(upgradeSdk).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /upgrade to 3\.0\.3/i }),
    ).toBeInTheDocument();
  });

  it("skips the confirm when the builder opted out of it", async () => {
    window.localStorage.setItem("aomi-build:sdk-upgrade-skip-confirm", "1");
    const upgradeSdk = vi.fn(async () => pullRequestResult);
    const outdated = makeDetail({
      sdkVersion: "3.0.2",
      requiredSdk: "3.0.3",
      upgradeSdk,
    });
    renderTab(<DeploymentsTab detail={outdated} />);

    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to 3\.0\.3/i }),
    );
    await screen.findAllByRole("link", { name: /review pr #7/i });
    expect(upgradeSdk).toHaveBeenCalledOnce();
  });

  it("detects the merge on re-check and unlocks redeploy", async () => {
    // openPr uses the heavy upgrade call; the re-check uses the cheap status
    // poll, which reports the PR merged.
    const upgradeSdk = vi.fn(async () => pullRequestResult);
    const checkSdkUpgradeStatus = vi.fn(async () => ({
      status: "merged" as const,
      requiredSdkVersion: "3.0.3",
      branch: "aomi/sdk-3.0.3",
      pullRequest: {
        number: 7,
        url: "https://github.com/alice/bot/pull/7",
        state: "closed",
        merged: true,
      },
    }));
    const outdated = makeDetail({
      sdkVersion: "3.0.2",
      requiredSdk: "3.0.3",
      upgradeSdk,
      checkSdkUpgradeStatus,
    });
    renderTab(<DeploymentsTab detail={outdated} />);

    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to 3\.0\.3/i }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: /open an upgrade pull request/i }),
      ).getByRole("button", { name: /open upgrade pr/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /i merged it — check now/i }),
    );

    expect(await screen.findByText(/pr merged/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeEnabled();
  });

  it("surfaces the manual-upgrade exit with the fix command", async () => {
    const upgradeSdk = vi.fn(async () => ({
      status: "manual" as const,
      requiredSdkVersion: "3.0.3",
      sourceRef: "abc1234",
      reason: "Cargo.lock must be regenerated locally;",
      command: "aomi-build sdk fix --required-version 3.0.3",
    }));
    const outdated = makeDetail({
      sdkVersion: "3.0.2",
      requiredSdk: "3.0.3",
      upgradeSdk,
    });
    renderTab(<DeploymentsTab detail={outdated} />);

    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to 3\.0\.3/i }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: /open an upgrade pull request/i }),
      ).getByRole("button", { name: /open upgrade pr/i }),
    );
    expect(
      await screen.findByText(/manual upgrade required/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/aomi-build sdk fix --required-version 3\.0\.3/),
    ).toBeInTheDocument();
  });

  it("expands a deployment's detail panel and lazy-loads history", async () => {
    renderTab(<DeploymentsTab detail={detail} />);
    const toggles = screen.getAllByRole("button", {
      name: /deployment detail/i,
    });
    fireEvent.click(toggles[0]);
    expect(detail.loadHistory).toHaveBeenCalled();
    expect(await screen.findByText("Source repository")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /a\/b/i })).toHaveAttribute(
      "href",
      "https://github.com/a/b",
    );
  });

  it("disables Promote for a deployment whose app has a missing required secret", () => {
    const blockedDetail = makeDetail({
      hasMissingSecrets: (app) => app === "my-bot",
    });
    renderTab(<DeploymentsTab detail={blockedDetail} />);
    expect(blockedDetail.loadRequiredSecrets).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /promote/i })).toBeDisabled();
    expect(screen.getByText(/required secrets missing/i)).toBeInTheDocument();
  });

  it("blocks redeploy and offers the Environment tab when secrets are missing", () => {
    const blockedDetail = makeDetail({
      hasMissingSecrets: (app) => app === "my-bot",
    });
    const openEnvironment = vi.fn();
    renderTab(
      <DeploymentsTab
        detail={blockedDetail}
        onOpenEnvironment={openEnvironment}
      />,
    );

    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Set required secrets" }),
    );
    expect(openEnvironment).toHaveBeenCalledOnce();
  });

  it("retries a failed required-secret check without refreshing the page", async () => {
    const refreshRequiredSecrets = vi.fn(async () => ({}));
    const failedDetail = {
      ...makeDetail(),
      requiredSecretsError: "Unable to verify required secrets. Try again.",
      refreshRequiredSecrets,
    } as typeof detail;
    renderTab(<DeploymentsTab detail={failedDetail} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Retry required secrets" }),
    );
    await waitFor(() => expect(refreshRequiredSecrets).toHaveBeenCalledOnce());
  });

  it("is honest when live but deployment history is empty", () => {
    const liveEmpty = {
      ...detail,
      recordsByApp: { "my-bot": [] },
    } as typeof detail;
    renderTab(<DeploymentsTab detail={liveEmpty} />);
    expect(screen.getByText("No deployment history yet")).toBeInTheDocument();
    expect(
      screen.getByText(/project is live, but no deployment records/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("No deployments yet")).not.toBeInTheDocument();
  });

  it("shows named CI stages and the run link without invented percentage progress", async () => {
    const running = {
      ...makeDetail(),
      attempts: {
        attempts: [
          {
            id: 11,
            branch: "main",
            commit: "abc123",
            status: "in_progress",
            conclusion: null,
            createdAt: new Date().toISOString(),
            url: "https://github.com/a/b/actions/runs/11",
            jobs: [
              {
                id: 2,
                name: "Build / my-bot",
                status: "in_progress",
                conclusion: null,
                steps: [],
              },
            ],
          },
        ],
        local: [],
        busy: true,
        isSuccess: true,
      },
    } as Detail;
    renderTab(<DeploymentsTab detail={running} />);
    expect(
      await screen.findByRole("list", { name: "Deployment stages" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View full CI logs/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
