import { describe, expect, it } from "vitest";
import type { UserProject } from "../src/launch/browser-client";
import {
  hasProjectForLaunchUrlContext,
  readLaunchUrlContext,
} from "../src/launch/state";

function source(
  installationId: number,
  repositoryLink: string | null,
): UserProject {
  return {
    id: installationId,
    installationId,
    repositoryId: null,
    repositoryLink,
    sourceRef: null,
    commitHash: null,
    githubAccount: null,
    githubUserId: null,
    boundPlatformId: null,
    apps: [],
  };
}

describe("readLaunchUrlContext", () => {
  it("returns null when the URL carries no launch context", () => {
    expect(readLaunchUrlContext("?launch=github")).toBeNull();
  });

  it("parses installation and repo context", () => {
    expect(
      readLaunchUrlContext(
        "?installation_id=42&repo=https%3A%2F%2Fgithub.com%2Fcecilia%2Fagent",
      ),
    ).toEqual({
      installationId: "42",
      repo: "cecilia/agent",
    });
  });
});

describe("hasProjectForLaunchUrlContext", () => {
  it("allows pages with no URL context", () => {
    expect(hasProjectForLaunchUrlContext([], null)).toBe(true);
  });

  it("matches a copied URL against the signed-in user's sources", () => {
    expect(
      hasProjectForLaunchUrlContext(
        [source(42, "https://github.com/cecilia/agent")],
        { installationId: "42", repo: "cecilia/agent" },
      ),
    ).toBe(true);
  });

  it("rejects a repo that belongs to a different signed-in user", () => {
    expect(
      hasProjectForLaunchUrlContext(
        [source(99, "https://github.com/phoebe/agent")],
        { installationId: "42", repo: "cecilia/agent" },
      ),
    ).toBe(false);
  });

  it("matches installation-only redirects", () => {
    expect(
      hasProjectForLaunchUrlContext([source(42, null)], {
        installationId: "42",
        repo: null,
      }),
    ).toBe(true);
  });
});
