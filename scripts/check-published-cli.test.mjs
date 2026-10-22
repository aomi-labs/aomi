import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPublishedCli } from "./check-published-cli.mjs";

let root;
const sleep = vi.fn();
beforeEach(() => {
  sleep.mockReset();
  root = mkdtempSync(join(tmpdir(), "aomi-cli-release-test-"));
  mkdirSync(join(root, "packages/cli"), { recursive: true });
  writeFileSync(
    join(root, "packages/cli/package.json"),
    JSON.stringify({ name: "@aomi-labs/cli", version: "0.1.2" }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("published CLI install gate", () => {
  it("accepts the expected version once the command group loads", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("0.1.2\n")
      .mockReturnValueOnce("Usage: aomi tx");
    expect(() => checkPublishedCli({ root, run, sleep })).not.toThrow();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("installs and runs the published CLI without npm or GitHub credentials", () => {
    vi.stubEnv("NODE_AUTH_TOKEN", "publish-secret");
    vi.stubEnv("npm_config__authToken", "publish-secret");
    vi.stubEnv("GH_TOKEN", "publish-secret");
    const run = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("0.1.2\n")
      .mockReturnValueOnce("Usage: aomi tx");
    checkPublishedCli({ root, run, sleep });
    vi.unstubAllEnvs();
    for (const [, args, options] of run.mock.calls) {
      expect(JSON.stringify(options.env)).not.toContain("publish-secret");
      if (args.includes("install"))
        expect(args.some((arg) => arg.startsWith("--userconfig="))).toBe(true);
    }
  });

  it("retries a lagging registry, then fails release when the package never appears", () => {
    const run = vi.fn(() => {
      throw new Error("npm E404 @aomi-labs/cli");
    });
    expect(() => checkPublishedCli({ root, run, sleep })).toThrow("npm E404");
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("rejects a shadowed or incorrect CLI version", () => {
    const run = vi.fn().mockReturnValueOnce("").mockReturnValueOnce("0.9.4\n");
    expect(() => checkPublishedCli({ root, run, sleep })).toThrow(
      "expected 0.1.2",
    );
  });

  it("requires the installed transaction command to load", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("0.1.2\n")
      .mockImplementationOnce(() => {
        throw new Error("missing runtime dependency");
      });
    expect(() => checkPublishedCli({ root, run, sleep })).toThrow(
      "missing runtime dependency",
    );
  });
});
