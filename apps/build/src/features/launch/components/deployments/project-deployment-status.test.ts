import { describe, expect, it } from "vitest";
import type { UserProject } from "@aomi-labs/deploy";
import { projectDeploymentStatus } from "./project-deployment-status";

function source(patch: Partial<UserProject>): UserProject {
  return {
    id: 1,
    installationId: 1,
    repositoryLink: "alice/bot",
    apps: [],
    latestDeployment: null,
    ...patch,
  };
}

describe("projectDeploymentStatus", () => {
  it("marks active apps as live (same story as Home)", () => {
    const status = projectDeploymentStatus(
      source({
        apps: [
          {
            name: "playground-example",
            isActive: true,
            loaded: true,
            appReleaseTag: "tag-1",
          },
        ],
      }),
    );
    expect(status.isLive).toBe(true);
    expect(status.label).toBe("Live deployment");
    expect(status.lifecycle.kind).toBe("live");
  });

  it("marks inactive apps with a prior release as deactivated", () => {
    const status = projectDeploymentStatus(
      source({
        apps: [
          {
            name: "my-bot",
            isActive: false,
            loaded: false,
            appReleaseTag: "tag-old",
          },
        ],
        latestDeployment: {
          state: "recorded",
          sdkVersion: "3.0.1",
          apps: [],
        },
      }),
    );
    expect(status.isLive).toBe(false);
    expect(status.label).toBe("Deactivated");
  });

  it("marks empty projects as freshly connected", () => {
    const status = projectDeploymentStatus(source({ apps: [] }));
    expect(status.isLive).toBe(false);
    expect(status.label).toBe("Connected — not deployed yet");
  });
});
