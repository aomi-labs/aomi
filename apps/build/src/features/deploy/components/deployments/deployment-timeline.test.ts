import { describe, expect, it } from "vitest";
import {
  buildActivityList,
  buildDeploymentList,
  deploymentIsBuilding,
  promoteBlockedReason,
  sortDeploymentsForTimeline,
} from "./deployment-timeline";

describe("buildDeploymentList", () => {
  it("returns [] for null", () => {
    expect(buildDeploymentList(null)).toEqual([]);
  });

  it("groups multi-app deploys by deployment id and decodes the commit", () => {
    const rows = buildDeploymentList({
      api: [
        {
          deploymentId: "dep_555_r0123abcdef_aaaaaaaaaaaa",
          releaseTag: "apps-555-r0123abcdef-api-aaaaaaaaaaaa",
          sdkVersion: "3.0.1",
          actor: "alice",
          createdAt: 10,
          current: true,
        },
      ],
      web: [
        {
          deploymentId: "dep_555_r0123abcdef_aaaaaaaaaaaa",
          releaseTag: "apps-555-r0123abcdef-web-aaaaaaaaaaaa",
          sdkVersion: "3.0.1",
          actor: "alice",
          createdAt: 10,
          current: false,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].apps.sort()).toEqual(["api", "web"]);
    expect(rows[0].releaseTags).toHaveLength(2);
    expect(rows[0].commit).toBe("aaaaaaaaaaaa");
    // current is true if any app is live
    expect(rows[0].current).toBe(true);
  });

  it("sorts newest-first and carries the latest actor", () => {
    const rows = buildDeploymentList({
      api: [
        {
          deploymentId: "dep_1_ra_new0",
          releaseTag: "t-new",
          sdkVersion: "3.0.1",
          actor: "bob",
          createdAt: 20,
          current: true,
        },
        {
          deploymentId: "dep_1_ra_old0",
          releaseTag: "t-old",
          sdkVersion: "3.0.1",
          actor: "alice",
          createdAt: 5,
          current: false,
        },
      ],
    });
    expect(rows.map((r) => r.deploymentId)).toEqual([
      "dep_1_ra_new0",
      "dep_1_ra_old0",
    ]);

    expect(rows[0].actor).toBe("bob");
  });

  it("shows deployed history even when no promotion record exists", () => {
    const rows = buildDeploymentList({ "somm-agent": [] }, [
      {
        deploymentId: "dep_141779906_rd076a82c30_90642ef5ef1b",
        state: "ready",
        deployBranch: "ceciliaz030/somm-agent/141779906/90642ef5ef1b",
        platformRepo: "aomi-labs/somm-finance-apps",
        commitHash: "90642ef5ef1bad92f3690c8c005355172676d9ed",
        ciStatus: "passed",
        ciUrl: null,
        releaseTags: ["apps-141779906-rd076a82c30-somm-agent-90642ef5ef1b"],
        sdkVersion: "3.0.4",
        createdAt: 1785132402,
        apps: [
          {
            name: "somm-agent",
            releaseTag: "apps-141779906-rd076a82c30-somm-agent-90642ef5ef1b",
          },
        ],
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        deploymentId: "dep_141779906_rd076a82c30_90642ef5ef1b",
        commit: "90642ef5ef1b",
        apps: ["somm-agent"],
        sdkVersion: "3.0.4",
      }),
    ]);
  });

  it("sorts current first for the timeline view", () => {
    const rows = sortDeploymentsForTimeline([
      {
        deploymentId: "dep_old",
        commit: "old",
        apps: ["bot"],
        releaseTags: ["t-old"],
        current: true,
        actor: "alice",
        sdkVersion: "3.0.1",
        createdAt: 5,
      },
      {
        deploymentId: "dep_new",
        commit: "new",
        apps: ["bot"],
        releaseTags: ["t-new"],
        current: false,
        actor: "bob",
        sdkVersion: "3.0.1",
        createdAt: 20,
      },
    ]);
    expect(rows.map((r) => r.deploymentId)).toEqual(["dep_old", "dep_new"]);
  });

  it("flattens activity newest-first with app names", () => {
    const rows = buildActivityList({
      api: [
        {
          deploymentId: "dep_1_ra_old0",
          releaseTag: "t-old",
          sdkVersion: "3.0.1",
          actor: "alice",
          createdAt: 5,
          current: false,
        },
      ],
      web: [
        {
          deploymentId: "dep_1_ra_new0",
          releaseTag: "t-new",
          sdkVersion: "3.0.1",
          actor: "bob",
          createdAt: 20,
          current: true,
        },
      ],
    });
    expect(rows.map((row) => `${row.app}:${row.deploymentId}`)).toEqual([
      "web:dep_1_ra_new0",
      "api:dep_1_ra_old0",
    ]);
  });
});

describe("deploymentIsBuilding", () => {
  it("is true while GitHub CI is pending or running", () => {
    expect(deploymentIsBuilding({ state: null, ciStatus: "running" })).toBe(
      true,
    );
    expect(deploymentIsBuilding({ state: null, ciStatus: "pending" })).toBe(
      true,
    );
  });

  it("is true while the deployment projection is mid-flight", () => {
    for (const state of ["building", "releasing", "pending"]) {
      expect(deploymentIsBuilding({ state, ciStatus: null })).toBe(true);
    }
  });

  it("is false once settled, and for a deployment with no build state", () => {
    expect(deploymentIsBuilding({ state: "ready", ciStatus: "passed" })).toBe(
      false,
    );
    expect(deploymentIsBuilding({ state: "failed", ciStatus: "failed" })).toBe(
      false,
    );
    expect(deploymentIsBuilding({ state: "no_ci", ciStatus: "no_ci" })).toBe(
      false,
    );
    // A deployment known only from promotion records carries no build state;
    // it is historical, not in flight, so it must not read as building.
    expect(deploymentIsBuilding({ state: null, ciStatus: null })).toBe(false);
  });
});

describe("promoteBlockedReason", () => {
  const settled = { state: "ready", ciStatus: "passed" };
  const idle = { busy: false, secretsBlocked: false };

  it("allows promotion of a settled deployment", () => {
    expect(promoteBlockedReason(settled, idle)).toBeNull();
  });

  // The reported bug: promote stayed clickable during CI, and each click
  // dispatched another run that queued behind the first.
  it("blocks promotion while the deployment is still building", () => {
    const reason = promoteBlockedReason(
      { state: "building", ciStatus: "running" },
      idle,
    );
    expect(reason).toMatch(/still building/i);
    expect(reason).toMatch(/second CI run/i);
  });

  it("blocks promotion while another operation is running", () => {
    expect(promoteBlockedReason(settled, { ...idle, busy: true })).toMatch(
      /still running/i,
    );
  });

  it("blocks promotion when required secrets are missing", () => {
    expect(
      promoteBlockedReason(settled, { ...idle, secretsBlocked: true }),
    ).toMatch(/secrets/i);
  });

  // An in-flight build is the more actionable thing to say: setting secrets
  // would not make the button work yet.
  it("reports the build before missing secrets", () => {
    expect(
      promoteBlockedReason(
        { state: "building", ciStatus: "running" },
        { busy: false, secretsBlocked: true },
      ),
    ).toMatch(/still building/i);
  });
});
