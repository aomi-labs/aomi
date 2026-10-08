import { describe, expect, it } from "vitest";
import type { UserProject } from "@aomi-labs/deploy";
import { projectSdk, sdkCompatibility } from "./sdk-compatibility";

describe("sdkCompatibility", () => {
  it.each([
    ["3.0.3", "3.0.3", "current"],
    ["3.0.2", "3.0.3", "outdated"],
    [null, "3.0.3", "unknown"],
  ] as const)("classifies %s against %s as %s", (stamped, required, state) => {
    expect(sdkCompatibility(stamped, required)).toBe(state);
  });
});

function project(overrides: Partial<UserProject> = {}): UserProject {
  return {
    id: 1663,
    installationId: 1,
    repositoryLink: "alice/bot",
    platformName: "community",
    apps: [
      {
        id: 2937808,
        name: "bot",
        label: null,
        platform: "community",
        isActive: true,
        isPublic: false,
        projectId: 1663,
        appReleaseTag: "apps-1-r1-bot-abc",
        targetTags: [],
      },
    ],
    latestDeployment: null,
    ...overrides,
  };
}

describe("projectSdk", () => {
  it("reports the recorded runtime SDK and flags it outdated", () => {
    const sdk = projectSdk(project({ sdkVersion: "5.0.0" }), "5.1.0");
    expect(sdk).toMatchObject({
      runtime: "5.0.0",
      compatibility: "outdated",
      outdated: true,
      unrecorded: false,
      label: "5.0.0",
    });
    expect(sdk.warning).toBe(
      "Active application built with SDK 5.0.0 — backend requires 5.1.0; redeploy to update.",
    );
  });

  it("is clean only when the runtime SDK is recorded and current", () => {
    expect(projectSdk(project({ sdkVersion: "5.1.0" }), "5.1.0")).toMatchObject(
      {
        compatibility: "current",
        outdated: false,
        unrecorded: false,
        warning: null,
      },
    );
  });

  // The index row (list read, no configuration) and the project page (detail
  // read, with configuration) must tell the same story for the same project.
  it("derives the same verdict from the list row and the detail read", () => {
    const listRow = project({ sdkVersion: "5.0.0", sdkVersions: ["5.0.0"] });
    const detail = project({
      sdkVersion: "5.0.0",
      sdkVersions: ["5.0.0"],
      configuration: {
        status: "valid",
        revision: "abc",
        configHash: "h",
        applications: [
          { path: "apps/bot", name: "bot", sdkVersion: "5.1.0", target: "x" },
        ],
      },
    });
    const fromList = projectSdk(listRow, "5.1.0");
    const fromDetail = projectSdk(detail, "5.1.0");
    expect(fromDetail.runtime).toBe(fromList.runtime);
    expect(fromDetail.compatibility).toBe(fromList.compatibility);
    expect(fromDetail.outdated).toBe(fromList.outdated);
    expect(fromDetail.label).toBe(fromList.label);
  });

  it.each([
    ["5.0.0", "outdated", true],
    ["5.1.0", "unknown", false],
  ] as const)(
    "preserves a partial %s summary as %s",
    (version, compatibility, outdated) => {
      const sdk = projectSdk(
        project({ sdkVersion: null, sdkVersions: [version] }),
        "5.1.0",
      );
      expect(sdk).toMatchObject({
        runtime: null,
        runtimeVersions: [version],
        unrecorded: true,
        compatibility,
        outdated,
        label: `${version} · runtime incomplete`,
      });
      expect(sdk.warning).not.toContain("SDK null");
      expect(sdk.warning).toBeTruthy();
    },
  );

  it("does not fill a partial live summary from a historical deployment", () => {
    const sdk = projectSdk(
      project({
        sdkVersion: null,
        sdkVersions: ["5.1.0"],
        latestDeployment: {
          deploymentId: "past",
          state: "failed",
          platformBranch: null,
          platformRepo: null,
          commitHash: null,
          ciStatus: null,
          ciUrl: null,
          releaseTags: [],
          createdAt: 1,
          apps: [],
          sdkVersion: "5.1.0",
        },
      }),
      "5.1.0",
    );
    expect(sdk).toMatchObject({
      runtime: null,
      unrecorded: true,
      compatibility: "unknown",
    });
  });

  it("names an unrecorded runtime SDK instead of a bare unknown", () => {
    const sdk = projectSdk(
      project({
        configuration: {
          status: "valid",
          revision: "abc",
          configHash: "h",
          applications: [
            { path: "apps/bot", name: "bot", sdkVersion: "5.0.0", target: "x" },
          ],
        },
      }),
      "5.1.0",
    );
    expect(sdk).toMatchObject({
      runtime: null,
      declared: "5.0.0",
      live: true,
      unrecorded: true,
      compatibility: "unknown",
      outdated: false,
      label: "5.0.0 · runtime unrecorded",
    });
    expect(sdk.warning).toContain("Runtime SDK unrecorded");
    expect(sdk.warning).toContain("repository declares 5.0.0");
    expect(sdk.warning).toContain("backend requires 5.1.0");
  });

  it("says runtime unrecorded for a live app even without a configuration", () => {
    expect(projectSdk(project(), "5.1.0")).toMatchObject({
      unrecorded: true,
      label: "Runtime SDK unrecorded",
    });
  });

  it("stays unknown, with no warning, when nothing is live", () => {
    const sdk = projectSdk(
      project({
        apps: [
          {
            id: 1,
            name: "bot",
            label: null,
            platform: "community",
            isActive: false,
            isPublic: false,
            projectId: 1663,
            appReleaseTag: "apps-1-r1-bot-abc",
            targetTags: [],
          },
        ],
      }),
      "5.1.0",
    );
    expect(sdk).toMatchObject({
      live: false,
      unrecorded: false,
      compatibility: "unknown",
      label: "SDK unknown",
      warning: null,
    });
  });

  it("flags mixed runtimes outdated when any live app lags", () => {
    const sdk = projectSdk(
      project({ sdkVersions: ["5.0.0", "5.1.0"] }),
      "5.1.0",
    );
    expect(sdk).toMatchObject({
      mixed: true,
      outdated: true,
      label: "SDK mixed",
    });
    expect(sdk.warning).toBe(
      "Live apps run SDK 5.0.0, 5.1.0 — backend requires 5.1.0; redeploy to update.",
    );
  });
});
