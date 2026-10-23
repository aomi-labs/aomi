import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getLastProjectId,
  setLastProjectId,
  lastEnvironmentHref,
  lastProjectHref,
  lastUsageHref,
  projectHref,
  usageHref,
} from "@/lib/project-navigation";

describe("project navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("stores and reads the last project id", () => {
    expect(getLastProjectId()).toBeNull();
    setLastProjectId(42);
    expect(getLastProjectId()).toBe(42);
  });

  it("ignores invalid last project ids", () => {
    setLastProjectId(-1);
    expect(getLastProjectId()).toBeNull();
  });

  it("builds project and usage hrefs", () => {
    expect(projectHref(42)).toBe("/projects/42");
    expect(projectHref(42, "home")).toBe("/projects/42");
    expect(projectHref(42, "environment")).toBe("/projects/42?tab=environment");
    expect(usageHref(42)).toBe("/operate/usage?project=42");
    expect(usageHref(null)).toBe("/operate/usage");
  });

  it("falls back when there is no last project", () => {
    expect(lastProjectHref()).toBe("/projects");
    expect(lastProjectHref("deployments")).toBe("/projects");
    expect(lastUsageHref()).toBe("/operate/usage");
    expect(lastEnvironmentHref()).toBe("/settings/secrets");
  });

  it("uses the last project when set", () => {
    setLastProjectId(7);
    expect(lastProjectHref()).toBe("/projects/7");
    expect(lastProjectHref("deployments")).toBe("/projects/7?tab=deployments");
    expect(lastUsageHref()).toBe("/operate/usage?project=7");
    expect(lastEnvironmentHref()).toBe("/projects/7?tab=environment");
  });
});
