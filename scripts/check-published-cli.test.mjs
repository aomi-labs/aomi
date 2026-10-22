import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPublishedCli } from "./check-published-cli.mjs";

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aomi-cli-release-test-"));
  mkdirSync(join(root, "packages/cli"), { recursive: true });
  writeFileSync(
    join(root, "packages/cli/package.json"),
    JSON.stringify({ name: "@aomi-labs/cli", version: "0.1.2" }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("published CLI install gate", () => {
  it("accepts the expected version with the Commit handoff commands", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("0.1.2\n")
      .mockReturnValueOnce("export submit sign");
    expect(() => checkPublishedCli({ root, run })).not.toThrow();
  });

  it("fails release when the replacement package cannot be installed", () => {
    const run = vi.fn(() => {
      throw new Error("npm E404 @aomi-labs/cli");
    });
    expect(() => checkPublishedCli({ root, run })).toThrow("npm E404");
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects a shadowed or incorrect CLI version", () => {
    const run = vi.fn().mockReturnValueOnce("").mockReturnValueOnce("0.9.4\n");
    expect(() => checkPublishedCli({ root, run })).toThrow("expected 0.1.2");
  });

  it("requires the installed transaction command to load", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("0.1.2\n")
      .mockImplementationOnce(() => {
        throw new Error("missing runtime dependency");
      });
    expect(() => checkPublishedCli({ root, run })).toThrow(
      "missing runtime dependency",
    );
  });

  it("rejects a CLI whose help cannot expose the Commit handoff", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("0.1.2\n")
      .mockReturnValueOnce("Usage: aomi");
    expect(() => checkPublishedCli({ root, run })).toThrow(
      "missing Commit export/submit commands",
    );
  });
});
