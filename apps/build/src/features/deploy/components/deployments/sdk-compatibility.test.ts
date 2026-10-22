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
  // Compatible, same SDK: green, nothing to say.
  it("is current when the verified FFI and the SDK both match the backend", () => {
    const sdk = projectSdk(project({
      sdkVersion: "6.0.0", sdkVersions: ["6.0.0"],
      ffiVersion: 1, ffiVersions: [1], requiredFfiVersion: 1,
    }), "6.0.0");
    expect(sdk).toMatchObject({
      compatibility: "current", outdated: false, incompatible: false,
      chatBlocked: false, severity: "info", rebuildWith: null, warning: null,
    });
  });

  // Compatible, SDK drift: amber warning and upgrade, but the runtime loads
  // it, so chat stays open.
  it("flags SDK drift on a supported FFI as outdated without blocking chat", () => {
    const sdk = projectSdk(project({
      sdkVersion: "5.1.1", sdkVersions: ["5.1.1"],
      ffiVersion: 1, ffiVersions: [1], requiredFfiVersion: 1,
    }), "6.0.0");
    expect(sdk).toMatchObject({
      compatibility: "outdated", outdated: true, incompatible: false,
      chatBlocked: false, severity: "warning", rebuildWith: null, label: "5.1.1",
    });
    expect(sdk.warning).toBe(
      "Active application built with SDK 5.1.1 — backend requires 6.0.0; redeploy to update.",
    );
  });

  it("treats mixed SDK releases sharing one verified FFI contract as drift", () => {
    const sdk = projectSdk(project({
      sdkVersion: null, sdkVersions: ["5.1.1", "6.0.0"],
      ffiVersion: 1, ffiVersions: [1], requiredFfiVersion: 1,
    }), "6.0.0");
    expect(sdk).toMatchObject({
      compatibility: "outdated", outdated: true, chatBlocked: false, mixed: true,
    });
    expect(sdk.warning).toBe(
      "Live apps run SDK 5.1.1, 6.0.0 — backend requires 6.0.0; redeploy to update.",
    );
  });

  // Fundamental interface mismatch: red everywhere, chat blocked, and the
  // copy never promises that matching the backend's SDK number is the fix.
  it("is incompatible, red and chat-blocked when a recorded SDK has no verified FFI", () => {
    const sdk = projectSdk(project({
      sdkVersion: "4.0.0", sdkVersions: ["4.0.0"],
      ffiVersion: null, ffiVersions: [], requiredFfiVersion: 1,
      ffiUnrecorded: true, ffiIncompatible: true, ffiUnverifiedSdkVersions: ["4.0.0"],
    }), "6.0.0");
    expect(sdk).toMatchObject({
      compatibility: "incompatible", outdated: false, incompatible: true,
      chatBlocked: true, severity: "error", label: "4.0.0",
      rebuildWith: "a supported SDK (5.1.1 or newer)",
    });
    expect(sdk.warning).toBe(
      "Active application built with SDK 4.0.0 cannot run on this backend (SDK 4.0.0 has no verified FFI contract); rebuild with a supported SDK (5.1.1 or newer) and redeploy.",
    );
    expect(sdk.warning).not.toContain("requires 6.0.0");
  });

  it("is incompatible when a verified FFI is not the backend's", () => {
    const sdk = projectSdk(project({
      sdkVersion: "7.0.0", sdkVersions: ["7.0.0"],
      ffiVersion: 2, ffiVersions: [2], requiredFfiVersion: 1,
    }), "6.0.0");
    expect(sdk).toMatchObject({
      compatibility: "incompatible", chatBlocked: true, severity: "error",
    });
    expect(sdk.warning).toBe(
      "Active application built with SDK 7.0.0 cannot run on this backend (app FFI 2 does not match backend FFI 1); rebuild with a supported SDK (5.1.1 or newer) and redeploy.",
    );
    // On a later host contract the only floor the UI knows is the backend's SDK.
    expect(projectSdk(project({
      sdkVersion: "6.0.0", ffiVersions: [1], requiredFfiVersion: 2,
    }), "7.0.0")).toMatchObject({
      compatibility: "incompatible",
      rebuildWith: "a supported SDK (7.0.0 or newer)",
    });
  });

  it("trusts the Manager's incompatible flag even without a named reason", () => {
    const sdk = projectSdk(project({
      sdkVersion: "4.0.0", requiredFfiVersion: 1, ffiUnrecorded: true, ffiIncompatible: true,
    }), "6.0.0");
    expect(sdk).toMatchObject({ compatibility: "incompatible", chatBlocked: true });
    expect(sdk.warning).toBe(
      "Active application built with SDK 4.0.0 cannot run on this backend; rebuild with a supported SDK (5.1.1 or newer) and redeploy.",
    );
  });

  it("names the offending SDK when live apps are mixed", () => {
    const sdk = projectSdk(project({
      sdkVersion: null, sdkVersions: ["4.0.0", "6.0.0"],
      ffiVersions: [1], requiredFfiVersion: 1,
      ffiUnrecorded: true, ffiIncompatible: true, ffiUnverifiedSdkVersions: ["4.0.0"],
    }), "6.0.0");
    expect(sdk).toMatchObject({ compatibility: "incompatible", label: "SDK mixed" });
    expect(sdk.warning).toBe(
      "A live app (SDK 4.0.0, 6.0.0) cannot run on this backend (SDK 4.0.0 has no verified FFI contract); rebuild with a supported SDK (5.1.1 or newer) and redeploy.",
    );
  });

  // Unknown: no record, neutral — and matching SDK metadata proves nothing.
  it("does not treat matching SDK metadata as proof of FFI compatibility", () => {
    expect(projectSdk(project({ sdkVersion: "6.0.0", requiredFfiVersion: 1 }), "6.0.0")).toMatchObject({
      compatibility: "unknown", chatBlocked: false, severity: "warning",
      warning: "Runtime FFI compatibility is unrecorded; redeploy to verify it.",
    });
    expect(projectSdk(project({ requiredFfiVersion: 1, ffiVersions: [1], ffiUnrecorded: true }), "6.0.0").compatibility).toBe("unknown");
  });

  // Old backend (no FFI metadata): SDK equality decides, and a mismatch still
  // blocks chat because that backend refuses foreign SDKs outright.
  it("falls back to SDK equality, blocking chat, when the backend reports no FFI", () => {
    const sdk = projectSdk(project({ sdkVersion: "5.0.0" }), "5.1.0");
    expect(sdk).toMatchObject({
      compatibility: "outdated", outdated: true, incompatible: false,
      chatBlocked: true, severity: "warning", rebuildWith: null,
    });
    expect(projectSdk(project({ sdkVersion: "5.1.0" }), "5.1.0")).toMatchObject({
      compatibility: "current", chatBlocked: false, severity: "info",
    });
  });

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
