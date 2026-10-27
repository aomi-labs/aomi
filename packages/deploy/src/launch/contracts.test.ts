import { describe, expect, it } from "vitest";

import { DeployPayload } from "../schemas";
import { deploymentTargets } from "./contracts";

const deployment = (apps: unknown[]) => DeployPayload.parse({ platform: { apps } });

describe("deploymentTargets", () => {
  it("preserves complete app/release pairs across wire shapes", () => {
    expect(
      deploymentTargets(
        deployment([
          { name: " alpha ", releaseTag: " release-a " },
          { name: "beta", release_tag: "release-b" },
        ]),
      ),
    ).toEqual([
      { name: "alpha", releaseTag: "release-a" },
      { name: "beta", releaseTag: "release-b" },
    ]);
  });

  it("rejects an incomplete manifest instead of misaligning arrays", () => {
    expect(
      deploymentTargets(deployment([{ name: "alpha", releaseTag: "release-a" }, { name: "beta" }])),
    ).toEqual([]);
  });
});
