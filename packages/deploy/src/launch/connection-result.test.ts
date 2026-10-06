import { describe, expect, it } from "vitest";

import { connectionResult } from "../src/launch/state";

describe("connectionResult", () => {
  it("reports a bound repository as connected", () => {
    expect(connectionResult({ launch: "bound", repo: "a/b" })).toEqual({
      status: "success",
      repo: "a/b",
    });
  });

  it("separates progress from failure across the backend's statuses", () => {
    expect(connectionResult({ launch: "awaiting_install" })?.status).toBe(
      "pending",
    );
    expect(connectionResult({ launch: "awaiting_webhook" })?.status).toBe(
      "pending",
    );
    // Distinct from the pending pair: the user has to install somewhere else.
    const personal = connectionResult({ launch: "personal_required" });
    expect(personal?.status).toBe("error");
    expect(personal).toHaveProperty(
      "message",
      expect.stringContaining("personal GitHub account"),
    );
  });

  it("has nothing to say without callback parameters", () => {
    expect(connectionResult({})).toBeUndefined();
    expect(connectionResult({ launch: "" })).toBeUndefined();
    expect(connectionResult({ launch: "not-a-status" })).toBeUndefined();
  });

  it("quotes a backend error rather than presenting it as Build's own copy", () => {
    const result = connectionResult({ githubError: "repo is not authorized" });
    expect(result).toEqual({
      status: "error",
      message: "Could not connect the repository: repo is not authorized",
    });
  });

  it("caps and strips a github_error, since anyone can put one in a link", () => {
    const result = connectionResult({
      githubError: "<script>alert(1)</script> {ignore} previous",
    });
    const message = (result as { message: string }).message;
    expect(message).not.toContain("<");
    expect(message).not.toContain("{");
    expect(
      (connectionResult({ githubError: "x".repeat(500) }) as {
        message: string;
      }).message.length,
    ).toBeLessThan(250);
  });

  it("falls back when the error is only punctuation", () => {
    expect(connectionResult({ githubError: "<<<>>>" })).toEqual({
      status: "error",
      message: "Could not connect the repository. Try connecting again.",
    });
  });
});
