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
    repositoryLink: "https://github.com/alice/channel",
    sourceRef: null,
    commitHash: null,
    githubAccount: "alice",
    githubUserId: "42",
    boundPlatformId: 1,
    agents: [],
    ...patch,
  };
}

describe("deploymentLifecycleFromProject", () => {
  it("treats active and loaded as live chat state", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        agents: [
          {
            id: 10,
            name: "channel",
            label: "channel",
            isActive: true,
            isPublic: true,
            projectId: 1,
            targetTags: [],
            loaded: true,
          },
        ],
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.chatAgent).toBe("channel");
    expect(lifecycle.chatAgentId).toBe(10);
  });

  it("treats active source agents as live even when runtime loaded is false", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        agents: [
          {
            id: 10,
            name: "channel",
            label: "channel",
            isActive: true,
            isPublic: true,
            projectId: 1,
            targetTags: [],
            loaded: false,
          },
        ],
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.releaseTags).toEqual([]);
    expect(lifecycle.chatAgent).toBe("channel");
    expect(lifecycle.chatAgentId).toBe(10);
  });

  it("uses latest deployment state for build-ready cards and links", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        agents: [
          {
            id: 10,
            name: "channel",
            label: "channel",
            isActive: true,
            isPublic: true,
            projectId: 1,
            targetTags: [],
            loaded: true,
          },
        ],
        latestDeployment: {
          deploymentId: "dep_1",
          state: "ready",
          platformBranch: "alice/channel/123/abc",
          platformRepo: "aomi-labs/community-agents",
          commitHash: "abc123",
          ciStatus: "passed",
          ciUrl: "https://github.com/aomi-labs/community-agents/actions/runs/1",
          releaseTags: ["agents-123-channel-abc"],
          agents: [
            {
              name: "channel",
              releaseTag: "agents-123-channel-abc",
              agentId: 10,
              isActive: false,
              loaded: false,
            },
          ],
        },
      }),
    );

    expect(lifecycle.kind).toBe("build_ready");
    expect(lifecycle.chatAgent).toBeUndefined();
    expect(lifecycle.branchUrl).toBe(
      "https://github.com/aomi-labs/community-agents/tree/alice%2Fchannel%2F123%2Fabc",
    );
    expect(lifecycle.ciUrl).toContain("/actions/runs/1");
  });

  it("uses the latest deployment active agent entry for live chat", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        latestDeployment: {
          deploymentId: "dep_1",
          state: "ready",
          platformBranch: "alice/channel/123/abc",
          platformRepo: "aomi-labs/community-agents",
          commitHash: "abc123",
          ciStatus: "passed",
          ciUrl: "https://github.com/aomi-labs/community-agents/actions/runs/1",
          releaseTags: ["agents-123-channel-abc"],
          agents: [
            {
              name: "channel",
              releaseTag: "agents-123-channel-abc",
              agentId: 42,
              isActive: true,
              loaded: false,
            },
          ],
        },
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.chatAgent).toBe("channel");
    expect(lifecycle.chatAgentId).toBe(42);
  });

  it("does not downgrade an active latest deployment to runtime pending", () => {
    const lifecycle = deploymentLifecycleFromProject(
      source({
        agents: [
          {
            id: 10,
            name: "channel",
            label: "channel",
            isActive: true,
            isPublic: true,
            projectId: 1,
            targetTags: [],
            loaded: true,
          },
        ],
        latestDeployment: {
          deploymentId: "dep_1",
          state: "ready",
          platformBranch: "alice/channel/123/abc",
          platformRepo: "aomi-labs/community-agents",
          commitHash: "abc123",
          ciStatus: "passed",
          ciUrl: "https://github.com/aomi-labs/community-agents/actions/runs/1",
          releaseTags: ["agents-123-channel-abc"],
          agents: [
            {
              name: "channel",
              releaseTag: "agents-123-channel-abc",
              agentId: 42,
              isActive: true,
              loaded: false,
            },
          ],
        },
      }),
    );

    expect(lifecycle.kind).toBe("live");
    expect(lifecycle.chatAgentId).toBe(42);
  });

  it("derives deployment ids from release tags", () => {
    expect(
      deploymentIdFromReleaseTag(
        "agents-141780080-r0fd515d1d4-playground-example-8819f32c4399",
      ),
    ).toBe("dep_141780080_r0fd515d1d4_8819f32c4399");
  });

  it("turns skipped CI status into a failed lifecycle with links", () => {
    const current = deploymentLifecycleFromProject(
      source({ repositoryLink: "alice/channel" }),
    );
    const lifecycle = deploymentLifecycleFromStatus(current, {
      state: "failed",
      deployment: {
        id: "dep_1",
        platform: {
          repository: "aomi-labs/community-agents",
          platformBranch: "alice/channel/123/abc",
          ciStatus: "pending",
          ciUrl:
            "https://github.com/aomi-labs/community-agents/actions?query=branch%3Aalice/channel/123/abc",
          agents: [
            {
              name: "channel",
              releaseTag: "agents-123-r1-channel-abc",
              target: "x86_64-unknown-linux-gnu",
            },
          ],
        },
      },
      releaseTags: ["agents-123-r1-channel-abc"],
      ci: {
        status: "skipped",
        url: "https://github.com/aomi-labs/community-agents/actions/runs/1",
      },
      message: 'Deploy channel completed with conclusion "skipped".',
    });

    expect(lifecycle.kind).toBe("failed");
    expect(lifecycle.statusLabel).toBe("CI skipped");
    expect(lifecycle.branchUrl).toContain("alice%2Fchannel%2F123%2Fabc");
    expect(lifecycle.failureReport).toContain("skipped");
  });

  it("keeps backend-building status in progress even when GitHub CI has passed", () => {
    const current = deploymentLifecycleFromProject(
      source({ repositoryLink: "alice/channel" }),
    );
    const lifecycle = deploymentLifecycleFromStatus(current, {
      state: "building",
      deployment: {
        id: "dep_1",
        platform: {
          repository: "aomi-labs/community-agents",
          platformBranch: "alice/channel/123/abc",
          agents: [
            { name: "channel", releaseTag: "agents-123-r1-channel-abc" },
          ],
        },
      },
      releaseTags: ["agents-123-r1-channel-abc"],
      ci: {
        status: "passed",
        url: "https://github.com/aomi-labs/community-agents/actions/runs/1",
      },
    });

    expect(lifecycle.kind).toBe("building");
    expect(lifecycle.statusLabel).toBe("Releasing");
    expect(lifecycle.progressPercent).toBe(70);
  });

  it("turns stale CI status into a failed lifecycle", () => {
    const current = deploymentLifecycleFromProject(
      source({ repositoryLink: "alice/channel" }),
    );
    const lifecycle = deploymentLifecycleFromStatus(current, {
      state: "failed",
      deployment: {
        id: "dep_1",
        platform: {
          repository: "aomi-labs/community-agents",
          platformBranch: "alice/channel/123/abc",
          agents: [
            { name: "channel", releaseTag: "agents-123-r1-channel-abc" },
          ],
        },
      },
      releaseTags: ["agents-123-r1-channel-abc"],
      ci: {
        status: "stale",
        url: "https://github.com/aomi-labs/community-agents/actions/runs/1",
      },
      message:
        'Deploy channel completed with conclusion "success" on stale commit abc123; deployment commit def456 has no matching Aomi CI run.',
    });

    expect(lifecycle.kind).toBe("failed");
    expect(lifecycle.statusLabel).toBe("CI stale");
    expect(lifecycle.progressLabel).toBe("CI stale");
    expect(lifecycle.failureReport).toContain("deployment commit def456");
  });
});
