import { describe, expect, it } from "vitest";
import type { UserProject } from "@aomi-labs/deploy";
import {
  deploymentLifecycleFromProject,
  deploymentLifecycleFromStatus,
  deploymentIdFromReleaseTag,
} from "@aomi-labs/deploy/lifecycle";

function source(patch: Partial<UserProject>): UserProject {
  return {
    id: 1,
    installationId: 123,
    repositoryId: 456,
    repositoryLink: "https://github.com/alice/bot",
    sourceRef: null,
    commitHash: null,
    githubAccount: "alice",
    githubUserId: "42",
    boundPlatformId: 1,
    apps: [],
    ...patch,
  };
}

describe("deploymentLifecycleFromProject", () => {
  it("treats active and loaded as live chat state", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        apps: [
          {
            id: 10,
            name: "bot",
            label: "bot",
            isActive: true,
            isPublic: true,
            projectId: 1,
            appReleaseTag: "apps-123-bot-abc",
            targetTags: [],
            loaded: true,
          },
        ],
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.chatApp).toBe("bot");
    expect(lifecycle.chatApplicationId).toBe(10);
  });

  it("treats active source apps as live even when runtime loaded is false", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        apps: [
          {
            id: 10,
            name: "bot",
            label: "bot",
            isActive: true,
            isPublic: true,
            projectId: 1,
            appReleaseTag: "apps-123-bot-abc",
            targetTags: [],
            loaded: false,
          },
        ],
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.releaseTags).toEqual(["apps-123-bot-abc"]);
    expect(lifecycle.chatApp).toBe("bot");
    expect(lifecycle.chatApplicationId).toBe(10);
  });

  it("uses latest deployment state for build-ready cards and links", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        apps: [
          {
            id: 10,
            name: "bot",
            label: "bot",
            isActive: true,
            isPublic: true,
            projectId: 1,
            appReleaseTag: "apps-123-bot-old",
            targetTags: [],
            loaded: true,
          },
        ],
        latestDeployment: {
          deploymentId: "dep_1",
          state: "ready",
          platformBranch: "alice/bot/123/abc",
          platformRepo: "aomi-labs/community-apps",
          commitHash: "abc123",
          ciStatus: "passed",
          ciUrl: "https://github.com/aomi-labs/community-apps/actions/runs/1",
          releaseTags: ["apps-123-bot-abc"],
          apps: [
            {
              name: "bot",
              releaseTag: "apps-123-bot-abc",
              applicationId: 10,
              isActive: false,
              loaded: false,
            },
          ],
        },
      }),
    );

    expect(lifecycle.kind).toBe("build_ready");
    expect(lifecycle.chatApp).toBeUndefined();
    expect(lifecycle.branchUrl).toBe(
      "https://github.com/aomi-labs/community-apps/tree/alice%2Fbot%2F123%2Fabc",
    );
    expect(lifecycle.ciUrl).toContain("/actions/runs/1");
  });

  it("uses the latest deployment active application entry for live chat", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        latestDeployment: {
          deploymentId: "dep_1",
          state: "ready",
          platformBranch: "alice/bot/123/abc",
          platformRepo: "aomi-labs/community-apps",
          commitHash: "abc123",
          ciStatus: "passed",
          ciUrl: "https://github.com/aomi-labs/community-apps/actions/runs/1",
          releaseTags: ["apps-123-bot-abc"],
          apps: [
            {
              name: "bot",
              releaseTag: "apps-123-bot-abc",
              applicationId: 42,
              isActive: true,
              loaded: false,
            },
          ],
        },
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.chatApp).toBe("bot");
    expect(lifecycle.chatApplicationId).toBe(42);
  });

  it("does not downgrade an active latest deployment to runtime pending", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        apps: [
          {
            id: 10,
            name: "bot",
            label: "bot",
            isActive: true,
            isPublic: true,
            projectId: 1,
            appReleaseTag: "apps-123-bot-old",
            targetTags: [],
            loaded: true,
          },
        ],
        latestDeployment: {
          deploymentId: "dep_1",
          state: "ready",
          platformBranch: "alice/bot/123/abc",
          platformRepo: "aomi-labs/community-apps",
          commitHash: "abc123",
          ciStatus: "passed",
          ciUrl: "https://github.com/aomi-labs/community-apps/actions/runs/1",
          releaseTags: ["apps-123-bot-abc"],
          apps: [
            {
              name: "bot",
              releaseTag: "apps-123-bot-abc",
              applicationId: 42,
              isActive: true,
              loaded: false,
            },
          ],
        },
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.chatApplicationId).toBe(42);
  });

  it("derives deployment ids from app release tags", () => {
    expect(
      deploymentIdFromReleaseTag(
        "apps-141780080-r0fd515d1d4-playground-example-8819f32c4399",
      ),
    ).toBe("dep_141780080_r0fd515d1d4_8819f32c4399");
  });

  it("turns skipped CI status into a failed lifecycle with links", () => {
    const current = deploymentLifecycleFromProject(
      source({ repositoryLink: "alice/bot" }),
    );
    const lifecycle = deploymentLifecycleFromStatus(current, {
      state: "failed",
      deployment: {
        id: "dep_1",
        platform: {
          repository: "aomi-labs/community-apps",
          platformBranch: "alice/bot/123/abc",
          ciStatus: "pending",
          ciUrl:
            "https://github.com/aomi-labs/community-apps/actions?query=branch%3Aalice/bot/123/abc",
          apps: [
            {
              name: "bot",
              releaseTag: "apps-123-r1-bot-abc",
              target: "x86_64-unknown-linux-gnu",
            },
          ],
        },
      },
      releaseTags: ["apps-123-r1-bot-abc"],
      ci: {
        status: "skipped",
        url: "https://github.com/aomi-labs/community-apps/actions/runs/1",
      },
      message: 'Deploy bot completed with conclusion "skipped".',
    });

    expect(lifecycle.kind).toBe("failed");
    expect(lifecycle.statusLabel).toBe("CI skipped");
    expect(lifecycle.branchUrl).toContain("alice%2Fbot%2F123%2Fabc");
    expect(lifecycle.failureReport).toContain("skipped");
  });

  it("keeps backend-building status in progress even when GitHub CI has passed", () => {
    const current = deploymentLifecycleFromProject(
      source({ repositoryLink: "alice/bot" }),
    );
    const lifecycle = deploymentLifecycleFromStatus(current, {
      state: "building",
      deployment: {
        id: "dep_1",
        platform: {
          repository: "aomi-labs/community-apps",
          platformBranch: "alice/bot/123/abc",
          apps: [{ name: "bot", releaseTag: "apps-123-r1-bot-abc" }],
        },
      },
      releaseTags: ["apps-123-r1-bot-abc"],
      ci: {
        status: "passed",
        url: "https://github.com/aomi-labs/community-apps/actions/runs/1",
      },
    });

    expect(lifecycle.kind).toBe("building");
    expect(lifecycle.statusLabel).toBe("Releasing");
    expect(lifecycle.progressPercent).toBe(70);
  });

  it("turns stale CI status into a failed lifecycle", () => {
    const current = deploymentLifecycleFromProject(
      source({ repositoryLink: "alice/bot" }),
    );
    const lifecycle = deploymentLifecycleFromStatus(current, {
      state: "failed",
      deployment: {
        id: "dep_1",
        platform: {
          repository: "aomi-labs/community-apps",
          platformBranch: "alice/bot/123/abc",
          apps: [{ name: "bot", releaseTag: "apps-123-r1-bot-abc" }],
        },
      },
      releaseTags: ["apps-123-r1-bot-abc"],
      ci: {
        status: "stale",
        url: "https://github.com/aomi-labs/community-apps/actions/runs/1",
      },
      message:
        'Deploy bot completed with conclusion "success" on stale commit abc123; deployment commit def456 has no matching Aomi CI run.',
    });

    expect(lifecycle.kind).toBe("failed");
    expect(lifecycle.statusLabel).toBe("CI stale");
    expect(lifecycle.progressLabel).toBe("CI stale");
    expect(lifecycle.failureReport).toContain("deployment commit def456");
  });
});
