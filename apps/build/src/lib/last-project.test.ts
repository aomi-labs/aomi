import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { getLastProjectId, setLastProjectId } from "@/lib/project-navigation";

describe("last-project", () => {
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

  it("ignores invalid ids", () => {
    setLastProjectId(-1);
    expect(getLastProjectId()).toBeNull();
  });
});
