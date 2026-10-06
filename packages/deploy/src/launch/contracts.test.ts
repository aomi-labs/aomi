import { describe, expect, it } from "vitest";

import { deploymentTargets } from "../src/launch/contracts";

describe("deploymentTargets", () => {
  it("preserves complete app/release pairs across wire shapes", () => {
    expect(
      deploymentTargets({
        platform: {
          apps: [
            { name: " alpha ", releaseTag: " release-a " },
            { name: "beta", release_tag: "release-b" },
          ],
        },
      }),
    ).toEqual([
      { name: "alpha", releaseTag: "release-a" },
      { name: "beta", releaseTag: "release-b" },
    ]);
  });

  it("rejects an incomplete manifest instead of misaligning arrays", () => {
    expect(
      deploymentTargets({
        platform: {
          apps: [{ name: "alpha", releaseTag: "release-a" }, { name: "beta" }],
        },
      }),
    ).toEqual([]);
  });
});
